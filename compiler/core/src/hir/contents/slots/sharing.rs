//! Current identities within the function's static may-alias ceiling.
//!
//! An allocation cuts its SSA name out of its previous identity. Phi edges
//! copy predecessor identities simultaneously; joins union the relations.
//! These components only invalidate freshness, never establish a null slot.
//! Joins climb a finite partition lattice of height at most V - 1. Allocation
//! and rebinding are fixed kills, and phi carry is a monotone transfer. Group
//! storage is linear; unions move only the smaller component's member index.

use super::Aliases;
use crate::hir::ValueId;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Default, Clone, PartialEq)]
pub(super) struct Sharing {
    of: FxHashMap<ValueId, usize>,
    groups: FxHashMap<usize, FxHashSet<ValueId>>,
    next: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Previous {
    Group(usize),
    Single(ValueId),
}

impl Sharing {
    pub(super) fn members(&self, value: ValueId) -> impl Iterator<Item = ValueId> + '_ {
        let group = self.of.get(&value).map(|key| &self.groups[key]);
        group
            .into_iter()
            .flat_map(|members| members.iter().copied())
            .chain(group.is_none().then_some(value))
    }

    pub(super) fn forget(&mut self, value: ValueId) {
        let Some(key) = self.of.remove(&value) else {
            return;
        };
        let Some(group) = self.groups.get_mut(&key) else {
            unreachable!("a current alias index must name its component");
        };
        group.remove(&value);
        if group.len() == 1 {
            if let Some(member) = group.iter().next() {
                self.of.remove(member);
            }
            self.groups.remove(&key);
        }
    }

    pub(super) fn take(&mut self, value: ValueId) -> Option<FxHashSet<ValueId>> {
        let key = self.of.get(&value).copied()?;
        let Some(members) = self.groups.remove(&key) else {
            unreachable!("a current alias index must name its component");
        };
        for member in &members {
            self.of.remove(member);
        }
        Some(members)
    }

    fn connect(&mut self, a: ValueId, b: ValueId) {
        if a == b {
            return;
        }
        match (self.of.get(&a).copied(), self.of.get(&b).copied()) {
            (None, None) => {
                let key = self.next;
                self.next += 1;
                self.of.insert(a, key);
                self.of.insert(b, key);
                self.groups.insert(key, FxHashSet::from_iter([a, b]));
            }
            (Some(key), None) => self.insert(key, b),
            (None, Some(key)) => self.insert(key, a),
            (Some(a), Some(b)) if a != b => self.merge(a, b),
            (Some(_), Some(_)) => {}
        }
    }

    fn insert(&mut self, key: usize, value: ValueId) {
        self.of.insert(value, key);
        self.groups.entry(key).or_default().insert(value);
    }

    fn merge(&mut self, a: usize, b: usize) {
        let (keep, remove) = if self.groups[&a].len() >= self.groups[&b].len() {
            (a, b)
        } else {
            (b, a)
        };
        let Some(members) = self.groups.remove(&remove) else {
            unreachable!("a current alias index must name its component");
        };
        for member in members {
            self.insert(keep, member);
        }
    }

    pub(super) fn union(&self, other: &Self) -> Self {
        let mut both = self.clone();
        for members in other.groups.values() {
            let mut members = members.iter().copied();
            if let Some(first) = members.next() {
                for member in members {
                    both.connect(first, member);
                }
            }
        }
        both
    }

    pub(super) fn across(
        &self,
        params: &[ValueId],
        args: &[ValueId],
        fresh: &FxHashSet<ValueId>,
        ceiling: &Aliases,
    ) -> Self {
        let rebound: FxHashSet<_> = params.iter().copied().collect();
        let mut carried = self.clone();
        for param in params {
            carried.forget(*param);
        }
        let mut representatives = FxHashMap::default();
        for (&param, &arg) in params.iter().zip(args) {
            let previous = self
                .of
                .get(&arg)
                .map_or(Previous::Single(arg), |key| Previous::Group(*key));
            // All arguments name predecessor values, including in a swap or
            // when every old view is itself a rebound parameter. Find one
            // survivor per old identity, or use its first new parameter.
            let representative = representatives.entry(previous).or_insert_with(|| {
                let mut known = false;
                let mut survivor = None;
                for member in self.members(arg) {
                    known |= fresh.contains(&member);
                    if !rebound.contains(&member) {
                        survivor = Some(member);
                    }
                }
                known.then_some(survivor.unwrap_or(param))
            });
            if let Some(representative) = *representative {
                debug_assert!(ceiling.may_share(param, arg));
                carried.connect(param, representative);
            }
        }
        carried
    }

    /// Union by size keeps transfer cheap. Canonical names are needed only at
    /// the existing block-state comparisons, so hash iteration order cannot
    /// cause false changes. Groups with no fresh member carry no authority;
    /// only another real allocation could make such a name fresh again.
    pub(super) fn canonicalize(&mut self, fresh: &FxHashSet<ValueId>) {
        if self.groups.is_empty() {
            self.next = 0;
            return;
        }
        let mut groups = Vec::with_capacity(self.groups.len());
        for (_, members) in self.groups.drain() {
            if members.iter().any(|member| fresh.contains(member))
                && let Some(key) = members.iter().map(|member| member.0 as usize).min()
            {
                groups.push((key, members));
            }
        }
        self.of.clear();
        self.next = 0;
        for (key, members) in groups {
            for member in &members {
                self.of.insert(*member, key);
            }
            self.next = self.next.max(key + 1);
            self.groups.insert(key, members);
        }
    }
}
