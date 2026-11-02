//! Sparse memory-event versions. The points-to graph owns every writer;
//! this column only orders those same writes along accepted control edges.
//! Facts move monotonically backward, with a fresh-allocation barrier for
//! the direct recent instance. No mutable slot is killed and repopulated.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::Reason;
use super::graph::{Graph, Object, Slot};

pub(super) type EventId = usize;
pub(super) type Key = (Object, Slot);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Origin {
    pub context: usize,
    pub value: super::super::ValueId,
}

#[derive(Debug, Clone)]
pub(super) struct Store {
    pub origin: Origin,
    pub base: usize,
    pub slot: Slot,
    pub version: usize,
}

#[derive(Debug, Default)]
struct Event {
    previous: BTreeSet<EventId>,
    fresh: BTreeSet<Object>,
    writes: BTreeSet<Key>,
    unknown: Option<Reason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
enum Facts {
    #[default]
    Empty,
    Writes(BTreeMap<Key, EventId>),
    Unknown(Reason),
}

#[derive(Debug, Default)]
pub(super) struct Events {
    events: Vec<Event>,
    facts: Vec<Facts>,
    changes: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaterWrite {
    ProvedNone { witness: String },
    MayWrite { witness: String },
    Unknown(Reason),
}

#[derive(Debug, Clone)]
enum Delta {
    Write(Key, EventId),
    Unknown(Reason),
}

impl Events {
    pub(super) fn node(&mut self) -> EventId {
        let at = self.events.len();
        self.events.push(Event::default());
        self.facts.push(Facts::Empty);
        self.changes.push(0);
        at
    }

    pub(super) fn edge(&mut self, from: EventId, to: EventId, graph: &mut Graph) {
        if graph.charge() {
            self.events[to].previous.insert(from);
        }
    }

    pub(super) fn fresh(&mut self, at: EventId, object: Object) {
        self.events[at].fresh.insert(object);
    }

    pub(super) fn write(&mut self, at: EventId, key: Key) {
        self.events[at].writes.insert(key);
    }

    pub(super) fn unknown(&mut self, at: EventId, reason: Reason) {
        self.events[at].unknown.get_or_insert(reason);
    }

    fn insert(&mut self, at: EventId, delta: &Delta, limit: usize) -> Option<Delta> {
        if matches!(self.facts[at], Facts::Unknown(_)) {
            return None;
        }
        let incoming = match delta {
            Delta::Unknown(reason) => {
                self.facts[at] = Facts::Unknown(reason.clone());
                delta.clone()
            }
            Delta::Write(key, witness) => {
                if let Facts::Empty = self.facts[at] {
                    self.facts[at] = Facts::Writes(BTreeMap::new());
                }
                let Facts::Writes(writes) = &mut self.facts[at] else {
                    unreachable!()
                };
                if writes.contains_key(key) {
                    return None;
                }
                if writes.len() >= limit {
                    let reason = Reason::StoreOrderBudget;
                    self.facts[at] = Facts::Unknown(reason.clone());
                    Delta::Unknown(reason)
                } else {
                    writes.insert(key.clone(), *witness);
                    delta.clone()
                }
            }
        };
        self.changes[at] += 1;
        debug_assert!(
            self.changes[at] <= limit + 1,
            "memory event {at} changed {} times at limit {limit}",
            self.changes[at]
        );
        Some(incoming)
    }

    pub(super) fn solve(&mut self, graph: &mut Graph) {
        let limit = graph.alias_limit.max(1);
        let mut pending = VecDeque::new();
        for (at, event) in self.events.iter().enumerate() {
            for key in &event.writes {
                pending.push_back((at, Delta::Write(key.clone(), at)));
            }
            if let Some(reason) = &event.unknown {
                pending.push_back((at, Delta::Unknown(reason.clone())));
            }
        }
        while let Some((at, delta)) = pending.pop_front() {
            if !graph.charge() {
                return;
            }
            let Some(delta) = self.insert(at, &delta, limit) else {
                continue;
            };
            if matches!(&delta, Delta::Write((object, _), _) if self.events[at].fresh.contains(object))
            {
                // The previous direct-instance lifetime ended at this fresh
                // allocation. Retained older/callback identities are separate.
                continue;
            }
            for &before in &self.events[at].previous {
                if !graph.charge() {
                    return;
                }
                pending.push_back((before, delta.clone()));
            }
        }
    }

    pub(super) fn query(&self, at: EventId, key: &Key, graph: &Graph) -> LaterWrite {
        if let Some(failure) = &graph.failure {
            return LaterWrite::Unknown(failure.clone());
        }
        match &self.facts[at] {
            Facts::Unknown(reason) => LaterWrite::Unknown(reason.clone()),
            Facts::Writes(writes) if writes.contains_key(key) => LaterWrite::MayWrite {
                witness: format!(
                    "later event {} writes object {} slot {:?}",
                    writes[key], key.0, key.1
                ),
            },
            _ => LaterWrite::ProvedNone {
                witness: format!(
                    "event {at}: complete backward writer column, fresh-instance barriers and no unknown outcome"
                ),
            },
        }
    }

    pub(super) fn changes(&self) -> &[usize] {
        &self.changes
    }
    pub(super) fn len(&self) -> usize {
        self.events.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_writes_use_order_and_fresh_iteration_lifetimes() {
        for write_after in [false, true] {
            let mut graph = Graph::new(10000, 1000);
            let mut events = Events::default();
            let fresh = events.node();
            let write = events.node();
            let capture = events.node();
            let tail = events.node();
            let key = (1, Slot::Field("binding".to_owned()));
            events.fresh(fresh, 1);
            events.write(write, key.clone());
            let order = if write_after {
                [fresh, capture, write, tail]
            } else {
                [fresh, write, capture, tail]
            };
            for pair in order.windows(2) {
                events.edge(pair[0], pair[1], &mut graph);
            }
            events.edge(tail, fresh, &mut graph);
            events.solve(&mut graph);
            assert!(graph.failure.is_none());
            assert_eq!(
                matches!(
                    events.query(capture, &key, &graph),
                    LaterWrite::MayWrite { .. }
                ),
                write_after
            );
            assert_eq!(
                matches!(
                    events.query(capture, &key, &graph),
                    LaterWrite::ProvedNone { .. }
                ),
                !write_after
            );
        }
    }

    #[test]
    fn missing_outcomes_poison_later_write_instead_of_proving_empty() {
        let mut graph = Graph::new(10000, 1000);
        let mut events = Events::default();
        let capture = events.node();
        let call = events.node();
        events.edge(capture, call, &mut graph);
        events.unknown(call, Reason::MissingOutcome("implicit call".to_owned()));
        events.solve(&mut graph);
        assert!(matches!(
            events.query(capture, &(1, Slot::Elements), &graph),
            LaterWrite::Unknown(Reason::MissingOutcome(_))
        ));
    }

    #[test]
    fn event_versions_widen_once_with_bounded_changes_and_linear_work() {
        for n in [16, 32, 64] {
            let mut graph = Graph::new(100000, 10000);
            let mut events = Events::default();
            let nodes: Vec<_> = (0..n).map(|_| events.node()).collect();
            for (at, &node) in nodes.iter().enumerate() {
                events.write(node, (at, Slot::Elements));
                events.edge(node, nodes[(at + 1) % n], &mut graph);
            }
            events.solve(&mut graph);
            assert!(graph.failure.is_none());
            assert!(
                events
                    .changes()
                    .iter()
                    .all(|changes| *changes <= graph.alias_limit + 1)
            );
            assert!(nodes.iter().all(|node| matches!(
                events.query(*node, &(0, Slot::Elements), &graph),
                LaterWrite::Unknown(_)
            )));
            assert!(graph.work <= 40 * n, "n={n}, work={}", graph.work);
        }
    }
}
