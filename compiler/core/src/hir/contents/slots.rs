//! Slot contents at a program point. This is the shared initialization owner
//! for fields and array elements. Today only ownership consumes it, through
//! `initializing_stores`; read initialization (`initialized.rs`) does not yet.

use crate::hir::{self, BlockId, Func, Layout, OpKind, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};
use std::sync::Arc;

mod summaries;
pub(in crate::hir) use summaries::{Summaries, summarize};
mod aliases;
pub(in crate::hir) use aliases::Aliases;
mod effects;
pub(in crate::hir) use effects::Inputs;
mod sharing;
use sharing::Sharing;
pub(in crate::hir) mod versioning;

#[cfg(test)]
mod tests;

/// Zero slots of confined allocations, plus explicit null facts established
/// by stores and call results. An explicit fact applies only at this point:
/// another possibly aliasing write or an open call kills it. Foreign retain
/// and release hooks may re-enter compiled code. This includes implicit retain
/// before a store, copied value definitions, operand cleanup and delayed exit
/// releases: all consume unknown call effects here. Fixed before effects run
/// before initialization queries and caller vouching; returned facts precede
/// after effects. A may-have-foreign-cleanup bit survives edges and writers,
/// joins with OR and invalidates at block exits before return summaries.
/// A managed release can run program code too: freeing an object gives up
/// the handles its layouts lead to, so a managed value or old slot value
/// whose type leads to a handle or an erased field counts as foreign cleanup
/// ([`hir::ForeignReleases`]). A managed value that leads to none frees
/// nothing that runs code; its finalization jobs run later.
#[derive(Debug, Default, Clone, PartialEq)]
pub(in crate::hir) struct Fresh {
    foreign_cleanup: bool,
    sharing: Sharing,
    /// Explicit slot facts do not assert freshness or a closed writer set.
    zero: Written,
    /// Objects and arrays whose slots this block still knows about.
    pub(in crate::hir) bases: rustc_hash::FxHashSet<ValueId>,
    /// Slots already written, so the second store to one is not initializing.
    written: Written,
    /// Bases that have been stored somewhere, and so can be read back out.
    ///
    /// Storing `x` into `y.f` writes *`y`*'s slot and leaves `x`'s alone, so `x`
    /// is still an object whose fields this knows about -- which is the whole of
    /// why a list built head-first can be built without counting. What it is no
    /// longer is *unaliased*: a load can now produce `x` under another name, and
    /// a store through that name would be a write this cannot attribute.
    ///
    /// So they stay, and the first load of any kind takes all of them away.
    escaped: rustc_hash::FxHashSet<ValueId>,
}

/// What is known on entry to every block, as a forward must-analysis.
///
/// A base is fresh on entry only where it is fresh on *every* path in, and a
/// slot counts as written where it is written on *any* of them: `initializing`
/// asks whether a store is writing over a zero, so both halves have to be true
/// everywhere for the answer to be yes.
///
/// Block parameters are what make this worth doing. A value carried around a
/// loop is a different value each time it arrives, so a fact about it dies on
/// the edge unless something carries it across -- and every list built
/// head-first stores through exactly such a value. Each edge maps its arguments
/// onto the successor's parameters and the facts travel with them.
///
/// Optimistic on unvisited predecessors, which is what makes it terminate at
/// the *greatest* fixpoint rather than refusing to enter a loop: the back edge
/// is checked against the assumption rather than consulted before it exists.
/// The same shape, and the same reason, as `crossing_borrows`.
pub(in crate::hir) fn freshness(
    func: &Func,
    layouts: &[Layout],
    harmless: &rustc_hash::FxHashSet<String>,
    zeroed: &rustc_hash::FxHashSet<(u32, u32)>,
    returned: &Returned,
    inputs: &Inputs,
) -> Analysis {
    let count = func.blocks.len();
    let incoming = hir::loops::predecessors(func);
    let mut entry: Vec<Option<Fresh>> = vec![None; count];
    let mut outgoing: Vec<Option<Fresh>> = vec![None; count];
    let mut pending = std::collections::VecDeque::new();
    let mut queued = vec![false; count];
    if count > 0 {
        entry[0] = Some(Fresh::entering(func, layouts, BlockId(0), zeroed));
        pending.push_back(0);
        queued[0] = true;
    }
    // None is the unvisited optimistic predecessor. Once reached, a base can
    // only acquire writes/aliases or lose its freshness. Allocation and null
    // stores are fixed transfer kills/gens. Canonicalization removes facts
    // about a base already lost, so each base/slot fact moves monotonically
    // through a finite lattice. No round limit can expose an optimistic prefix.
    while let Some(from) = pending.pop_front() {
        queued[from] = false;
        let Some(mut after) = entry[from].clone() else {
            continue;
        };
        for &value in &func.blocks[from].ops {
            after.observe(
                func,
                value,
                &func.values[value.0 as usize].kind,
                harmless,
                returned,
                inputs,
            );
        }
        after.end_block(inputs);
        after.canonicalize();
        if outgoing[from].as_ref() == Some(&after) {
            continue;
        }
        outgoing[from] = Some(after);
        for successor in func.blocks[from].terminator.successors() {
            let at = successor.0 as usize;
            // The entry contract is fixed, rather than a loop-carried claim.
            if at == 0 {
                continue;
            }
            let mut merged: Option<Fresh> = None;
            for (predecessor, args) in &incoming[at] {
                let Some(after) = &outgoing[predecessor.0 as usize] else {
                    continue;
                };
                let carried = after.across(&func.blocks[at].params, args, &inputs.aliases);
                merged = Some(match merged {
                    None => carried,
                    Some(other) => other.both(&carried),
                });
            }
            if let Some(facts) = &mut merged {
                facts.canonicalize();
            }
            if entry[at] != merged {
                entry[at] = merged;
                if !queued[at] {
                    queued[at] = true;
                    pending.push_back(at);
                }
            }
        }
    }
    Analysis {
        entering: entry.into_iter().map(Option::unwrap_or_default).collect(),
        leaving: outgoing,
    }
}

/// The slots written so far, by the base they belong to.
///
/// Forgetting a base's slots -- an allocation makes them zeros again, an edge
/// re-binds a block parameter -- is one removal. A set of pairs was a walk over
/// every slot written so far, for each allocation: one block of 16,000 object
/// literals wrote 32,000 slots and walked them 16,000 times.
///
/// Holds no empty set of slots, so two that hold the same slots are equal, as
/// the fixpoint that compares them needs.
#[derive(Debug, Default, Clone)]
struct Written {
    facts: FxHashMap<ValueId, FxHashSet<Slot>>,
    index: Option<WrittenIndex>,
}

/// Derived lookup data, never part of the must-analysis lattice. Only explicit
/// zero facts need it; the written-slot set stays indexed by base alone.
#[derive(Debug, Clone)]
struct WrittenIndex {
    aliases: Arc<Aliases>,
    slots: FxHashMap<Slot, FxHashSet<ValueId>>,
    components: FxHashMap<(usize, Slot), FxHashSet<ValueId>>,
}

impl PartialEq for Written {
    fn eq(&self, other: &Self) -> bool {
        self.facts == other.facts
    }
}

impl WrittenIndex {
    fn insert(&mut self, base: ValueId, slot: Slot) {
        self.slots.entry(slot).or_default().insert(base);
        self.components
            .entry((self.aliases.component(base), slot))
            .or_default()
            .insert(base);
    }

    fn remove(&mut self, base: ValueId, slot: Slot) {
        let key = (self.aliases.component(base), slot);
        if let Some(bases) = self.slots.get_mut(&slot) {
            bases.remove(&base);
            if bases.is_empty() {
                self.slots.remove(&slot);
            }
        }
        if let Some(bases) = self.components.get_mut(&key) {
            bases.remove(&base);
            if bases.is_empty() {
                self.components.remove(&key);
            }
        }
    }
}

/// Fields and indexed elements never share a slot merely because their
/// numeric indices happen to agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(in crate::hir) enum Slot {
    Field(u32),
    Element(u64),
}

pub(in crate::hir) type Returned = FxHashMap<String, FxHashSet<u32>>;

pub(in crate::hir) struct Analysis {
    pub(in crate::hir) entering: Vec<Fresh>,
    leaving: Vec<Option<Fresh>>,
}

impl Written {
    fn contains(&self, base: ValueId, slot: Slot) -> bool {
        self.facts
            .get(&base)
            .is_some_and(|slots| slots.contains(&slot))
    }

    fn insert(&mut self, base: ValueId, slot: Slot) {
        if self.facts.entry(base).or_default().insert(slot)
            && let Some(index) = &mut self.index
        {
            index.insert(base, slot);
        }
    }

    fn remove(&mut self, base: ValueId, slot: Slot) {
        if let Some(slots) = self.facts.get_mut(&base) {
            if slots.remove(&slot)
                && let Some(index) = &mut self.index
            {
                index.remove(base, slot);
            }
            if slots.is_empty() {
                self.facts.remove(&base);
            }
        }
    }

    /// Every slot of `base` is a zero again, or `base` names something new.
    fn forget(&mut self, base: ValueId) {
        if let Some(slots) = self.facts.remove(&base)
            && let Some(index) = &mut self.index
        {
            for slot in slots {
                index.remove(base, slot);
            }
        }
    }

    fn intersection(&self, other: &Self) -> Self {
        let mut both = self.clone();
        both.retain(|base, slot| other.contains(base, slot));
        both
    }

    fn bind(&mut self, aliases: &Arc<Aliases>) {
        if self
            .index
            .as_ref()
            .is_some_and(|index| Arc::ptr_eq(&index.aliases, aliases))
        {
            return;
        }
        let mut index = WrittenIndex {
            aliases: Arc::clone(aliases),
            slots: FxHashMap::default(),
            components: FxHashMap::default(),
        };
        for (&base, slots) in &self.facts {
            for &slot in slots {
                index.insert(base, slot);
            }
        }
        self.index = Some(index);
    }

    /// Visits only facts for this slot and, for a confined writer, its alias
    /// ceiling. Debug/test compilers compare every result with the full scan.
    /// The returned visits count excludes that deliberately exhaustive check.
    fn invalidate(
        &mut self,
        slot: Slot,
        confined: Option<ValueId>,
        aliases: &Arc<Aliases>,
    ) -> usize {
        self.bind(aliases);
        #[cfg(debug_assertions)]
        let expected = {
            let mut facts = self.facts.clone();
            facts.retain(|base, slots| {
                if confined.is_none_or(|writer| aliases.may_share(writer, *base)) {
                    slots.remove(&slot);
                }
                !slots.is_empty()
            });
            facts
        };
        let index = self.index.as_ref().unwrap();
        let affected = match confined {
            Some(writer) => index.components.get(&(aliases.component(writer), slot)),
            None => index.slots.get(&slot),
        };
        let affected: Vec<_> = affected.into_iter().flatten().copied().collect();
        let visits = affected.len();
        for base in affected {
            self.remove(base, slot);
        }
        #[cfg(debug_assertions)]
        assert_eq!(
            self.facts, expected,
            "indexed slot invalidation disagrees with full scan"
        );
        visits
    }

    fn retain(&mut self, keep: impl Fn(ValueId, Slot) -> bool) {
        let removed: Vec<_> = self
            .facts
            .iter()
            .flat_map(|(&base, slots)| {
                let keep = &keep;
                slots
                    .iter()
                    .filter_map(move |&slot| (!keep(base, slot)).then_some((base, slot)))
            })
            .collect();
        for (base, slot) in removed {
            self.remove(base, slot);
        }
    }

    fn retain_bases(&mut self, keep: impl Fn(&ValueId) -> bool) {
        let removed: Vec<_> = self
            .facts
            .keys()
            .filter(|base| !keep(base))
            .copied()
            .collect();
        for base in removed {
            self.forget(base);
        }
    }

    /// `to` has written what `from` had written in `of`.
    fn carry(&mut self, of: &Self, from: ValueId, to: ValueId) {
        if let Some(slots) = of.facts.get(&from) {
            for &slot in slots {
                self.insert(to, slot);
            }
        }
    }

    fn union(&self, other: &Self) -> Self {
        let mut both = self.clone();
        for (&base, slots) in &other.facts {
            for &slot in slots {
                both.insert(base, slot);
            }
        }
        both
    }
}

impl Fresh {
    /// Once a base is not fresh, its alias and slot marks carry no authority.
    /// A later allocation resets them, and phi rebinding clears them too.
    fn canonicalize(&mut self) {
        let bases = &self.bases;
        self.written.retain_bases(|base| bases.contains(base));
        self.escaped.retain(|base| self.bases.contains(base));
        self.sharing.canonicalize(&self.bases);
    }

    /// What is known on entry to a block.
    pub(in crate::hir) fn entering(
        func: &Func,
        _layouts: &[Layout],
        block: BlockId,
        zeroed: &rustc_hash::FxHashSet<(u32, u32)>,
    ) -> Self {
        let mut fresh = Self::default();
        if block == BlockId(0) {
            let parameters = func.parameter_values().unwrap_or_default();
            for (slot, field) in zeroed {
                if let Some(parameter) = parameters.get(*slot as usize).copied().flatten() {
                    fresh.zero.insert(parameter, Slot::Field(*field));
                }
            }
        }
        // A constructor's receiver arrives freshly allocated. Only in the entry
        // block: a later block may be reached by a path that already wrote.
        if func.initializes_receiver
            && block == BlockId(0)
            && let Some(receiver) = func
                .parameter_values()
                .and_then(|values| values.first().copied().flatten())
        {
            fresh.bases.insert(receiver);
        }
        fresh
    }

    /// The same facts, seen from the far side of an edge.
    ///
    /// A value the predecessor knew about is still that value in the successor
    /// -- SSA, so a name means one thing everywhere -- and on top of that, each
    /// argument hands its facts to the parameter that receives it.
    fn across(&self, params: &[ValueId], args: &[ValueId], aliases: &Aliases) -> Self {
        let mut carried = Self {
            foreign_cleanup: self.foreign_cleanup,
            sharing: self.sharing.across(params, args, &self.bases, aliases),
            zero: self.zero.clone(),
            bases: self.bases.clone(),
            written: self.written.clone(),
            escaped: self.escaped.clone(),
        };
        // A block parameter is re-bound on arrival, so nothing known about what
        // it held last time survives the edge. Around a back edge those facts
        // are stale by exactly one iteration, and the one that matters is
        // `written`: a list built head-first writes `tail.next` every time
        // round, and carrying that back made the *next* `tail` -- a different
        // link entirely -- look like a slot that had already been written.
        for param in params {
            carried.bases.remove(param);
            carried.escaped.remove(param);
            carried.written.forget(*param);
            carried.zero.forget(*param);
        }
        for (slot, param) in params.iter().enumerate() {
            let Some(arg) = args.get(slot) else { continue };
            if self.bases.contains(arg) {
                carried.bases.insert(*param);
            }
            if self.escaped.contains(arg) {
                carried.escaped.insert(*param);
            }
            carried.written.carry(&self.written, *arg, *param);
            carried.zero.carry(&self.zero, *arg, *param);
        }
        carried
    }

    /// What two paths into one block agree about.
    ///
    /// Fresh where both are fresh, written where either is: `initializing` says
    /// yes only when the slot is a zero however the block was reached.
    fn both(&self, other: &Self) -> Self {
        Self {
            foreign_cleanup: self.foreign_cleanup || other.foreign_cleanup,
            sharing: self.sharing.union(&other.sharing),
            zero: self.zero.intersection(&other.zero),
            bases: self.bases.intersection(&other.bases).copied().collect(),
            written: self.written.union(&other.written),
            // Reachable on either path is reachable.
            escaped: self.escaped.union(&other.escaped).copied().collect(),
        }
    }

    pub(in crate::hir) fn known_zero(&self, base: ValueId, slot: Slot) -> bool {
        self.zero.contains(base, slot)
            || (self.bases.contains(&base) && !self.written.contains(base, slot))
    }

    /// Whether this store is writing over a zero.
    pub(in crate::hir) fn initializing(&self, func: &Func, store: &OpKind) -> bool {
        match store {
            OpKind::FieldSet { object, field, .. } => self.known_zero(*object, Slot::Field(*field)),
            OpKind::ArraySet { array, index, .. } => slot_of(func, *index)
                .is_some_and(|slot| self.known_zero(*array, Slot::Element(slot))),
            _ => false,
        }
    }

    /// Take an operation into account.
    pub(in crate::hir) fn observe(
        &mut self,
        func: &Func,
        value: ValueId,
        kind: &OpKind,
        harmless: &rustc_hash::FxHashSet<String>,
        returned: &Returned,
        inputs: &Inputs,
    ) {
        let aliases = &inputs.aliases;
        self.before(value, inputs);
        self.foreign_cleanup |= inputs.after(value);
        let cleanup = inputs.cleanup(value) && !self.initializing(func, kind);
        // A call that only initializes leaves its argument as fresh as it
        // arrived. See `initializing_only`.
        if let OpKind::Call {
            callee: hir::Callee::Direct(name),
            ..
        } = kind
            && harmless.contains(name)
        {
            if inputs.after(value) {
                self.unknown_call(aliases);
            }
            return;
        }
        match effect(kind) {
            Effect::Allocate => {
                self.sharing.forget(value);
                self.bases.insert(value);
                self.escaped.remove(&value);
                // Every slot of it is zero again. This is only observable now
                // that facts travel around a back edge: an allocation inside a
                // loop arrived at its own block carrying the writes the *last*
                // time round made to it, so the first store to each field
                // stopped being an initializing one and loaded and released a
                // null. It made `store-elsewhere` twice as expensive as it had
                // been an hour earlier, which is the sort of thing a suite that
                // runs in twenty seconds says immediately.
                self.written.forget(value);
                self.zero.forget(value);
            }
            Effect::FieldWrite {
                object,
                field,
                stored,
            } => {
                // Storing a null puts the slot back the way the allocator left
                // it, so the *next* store to it writes over a zero and owes no
                // release. Recording it as written meant a field cleared and
                // refilled in a loop loaded and released a null every time
                // round -- `nulled-field` pays one an iteration for exactly
                // that.
                // A confined allocation cannot be a pre-existing parameter or
                // an unrelated object. The alias ceiling is only consulted
                // under that proof: distinct SSA names alone prove nothing.
                // Publication ends confinement before any subsequent writer.
                let confined = self.bases.contains(&object) && !self.escaped.contains(&object);
                self.zero
                    .invalidate(Slot::Field(field), confined.then_some(object), aliases);
                if matches!(func.values[stored.0 as usize].kind, OpKind::ConstNull) {
                    self.zero.insert(object, Slot::Field(field));
                    self.written.remove(object, Slot::Field(field));
                } else {
                    self.mark_written(aliases, object, Slot::Field(field));
                }
            }
            Effect::ElementWrite { array, index, .. } => {
                // Unknown array aliases may name the same indexed slot.
                self.zero.retain(|_, slot| matches!(slot, Slot::Field(_)));
                if let Some(slot) = slot_of(func, index) {
                    self.mark_written(aliases, array, Slot::Element(slot));
                } else {
                    // An index this pass cannot name could be any of them, so
                    // the whole array stops being something it knows about.
                    self.give_up(aliases, array);
                }
            }
            // A load can hand back something that was stored, under a name this
            // cannot connect to the original -- and a store through *that* name
            // would be a write attributed to the wrong value. So the first load
            // gives up everything that has been stored anywhere.
            Effect::Read => {
                self.forget_escaped(aliases);
            }
            Effect::Call => {
                self.unknown_call(aliases);
            }
            // Neither the address nor the slot is attributable here. Distinct
            // SSA names do not establish distinct storage. A release can also
            // run foreign cleanup; retaining a foreign handle can run callbacks.
            Effect::UnknownWrite => {
                // A writer cannot undo an earlier native value's delayed
                // cleanup, even though it destroys every current slot fact.
                let foreign_cleanup = self.foreign_cleanup;
                *self = Self {
                    foreign_cleanup,
                    ..Self::default()
                };
            }
            Effect::GlobalWrite { .. } | Effect::NoWrite => {}
        }
        for value in hir::own::escaping_operands(kind) {
            // A store keeps the base and only marks it reachable. Everything
            // else that hands a reference somewhere gives it up outright.
            if matches!(
                kind,
                OpKind::FieldSet { .. } | OpKind::ArraySet { .. } | OpKind::GlobalSet { .. }
            ) {
                for member in self.sharing.members(value) {
                    debug_assert!(aliases.may_share(value, member));
                    if self.bases.contains(&member) {
                        self.escaped.insert(member);
                    }
                }
            } else {
                self.give_up(aliases, value);
            }
        }
        if let OpKind::Call {
            callee: hir::Callee::Direct(name),
            ..
        } = kind
            && let Some(fields) = returned.get(name)
        {
            for field in fields {
                self.zero.insert(value, Slot::Field(*field));
            }
        }
        if cleanup || inputs.after(value) {
            self.unknown_call(aliases);
        }
    }

    pub(in crate::hir) fn end_block(&mut self, inputs: &Inputs) {
        if self.foreign_cleanup {
            self.unknown_call(&inputs.aliases);
        }
    }

    /// Potential native counts precede old-slot reads and callee entry. Their
    /// callbacks invalidate authority before initialization or caller vouching.
    pub(in crate::hir) fn before(&mut self, value: ValueId, inputs: &Inputs) {
        if inputs.before(value) {
            self.unknown_call(&inputs.aliases);
        }
    }

    fn unknown_call(&mut self, aliases: &Aliases) {
        self.zero = Written::default();
        self.forget_escaped(aliases);
    }

    fn mark_written(&mut self, aliases: &Aliases, base: ValueId, slot: Slot) {
        // A phi can still name the original allocation. This relation only
        // invalidates: a null store establishes a fact for its exact name.
        for member in self.sharing.members(base) {
            debug_assert!(aliases.may_share(base, member));
            if self.bases.contains(&member) {
                self.written.insert(member, slot);
            }
        }
    }

    fn give_up(&mut self, aliases: &Aliases, base: ValueId) {
        let members = self.sharing.take(base);
        let single = members.is_none().then_some(base);
        for member in members.into_iter().flatten().chain(single) {
            debug_assert!(aliases.may_share(base, member));
            self.bases.remove(&member);
            self.escaped.remove(&member);
        }
    }

    fn forget_escaped(&mut self, aliases: &Aliases) {
        let mut escaped = std::mem::take(&mut self.escaped);
        while let Some(base) = escaped.iter().next().copied() {
            // Visit a published component once even if it has many SSA views.
            let members = self.sharing.take(base);
            let single = members.is_none().then_some(base);
            for member in members.into_iter().flatten().chain(single) {
                debug_assert!(aliases.may_share(base, member));
                self.bases.remove(&member);
                escaped.remove(&member);
            }
        }
    }
}

/// The transfer's one structural classification. New HIR operations cannot
/// preserve slot authority until their effect has been decided here.
#[derive(Clone, Copy)]
enum Effect {
    Allocate,
    FieldWrite {
        object: ValueId,
        field: u32,
        stored: ValueId,
    },
    ElementWrite {
        array: ValueId,
        index: ValueId,
        stored: ValueId,
    },
    GlobalWrite {
        global: u32,
        stored: ValueId,
    },
    Read,
    Call,
    UnknownWrite,
    NoWrite,
}

fn effect(kind: &OpKind) -> Effect {
    match kind {
        OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } => Effect::Allocate,
        OpKind::FieldSet {
            object,
            field,
            value,
        } => Effect::FieldWrite {
            object: *object,
            field: *field,
            stored: *value,
        },
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => Effect::ElementWrite {
            array: *array,
            index: *index,
            stored: *value,
        },
        OpKind::GlobalSet { global, value } => Effect::GlobalWrite {
            global: *global,
            stored: *value,
        },
        OpKind::FieldGet { .. }
        | OpKind::OpenFieldGet { .. }
        | OpKind::SharedFieldGet { .. }
        | OpKind::ArrayGet { .. }
        | OpKind::GlobalGet(_) => Effect::Read,
        // Use the same external-effect owner as borrow invalidation. A helper
        // that writes no program storage cannot erase a parameter's explicit
        // null facts. Implicit native counts still invalidate before/after
        // this transfer through Inputs; this grants no cleanup exemption.
        OpKind::Call {
            callee: hir::Callee::External(name),
            ..
        } if hir::runtime::stores_nothing(name) => Effect::NoWrite,
        OpKind::Call { .. }
        | OpKind::Suspend { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::PromiseSubscribe { .. } => Effect::Call,
        OpKind::OpenFieldSet { .. }
        | OpKind::NativeStore { .. }
        | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. }
        | OpKind::NativeFree { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_) => Effect::UnknownWrite,
        // None writes an existing field or array slot. GlobalSet publishes an
        // identity, handled by escaping_operands after this transfer.
        OpKind::Validation(_)
        | OpKind::Optional { .. }
        | OpKind::OptionalDefined(_)
        | OpKind::OptionalPayload(_)
        | OpKind::ConstHandle(_)
        | OpKind::NativeLoad { .. }
        | OpKind::NativeLocal { .. }
        | OpKind::ObjcClass { .. }
        | OpKind::ObjcSelector { .. }
        | OpKind::NativeSizeOf(_)
        | OpKind::NativeMalloc { .. }
        | OpKind::NativePointerBits { .. }
        | OpKind::NativeStringView { .. }
        | OpKind::NativeIndexAddress { .. }
        | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. }
        | OpKind::NativeBridge { .. }
        | OpKind::DelegateInvoke { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::Provided(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::Erase { .. }
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
        | OpKind::Binary { .. }
        | OpKind::Unary { .. }
        | OpKind::Convert(_)
        | OpKind::FieldView { .. }
        | OpKind::Return(_)
        | OpKind::Length(_)
        | OpKind::StringUnitAt { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::CellReady { .. }
        | OpKind::ClosureStatic
        | OpKind::InstanceOf { .. }
        | OpKind::ViewOfClass { .. } => Effect::NoWrite,
    }
}

/// An array index as a slot number, when it is a constant.
///
/// A computed index names no particular slot, and the caller treats that as
/// naming all of them.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the guards make the conversion exact: non-negative, whole, and \
              within `u32`, which is every index an array can have"
)]
pub(in crate::hir) fn slot_of(func: &Func, index: ValueId) -> Option<u64> {
    match func.values[index.0 as usize].kind {
        OpKind::ConstInt(value) => u64::try_from(value).ok(),
        // Lowering produces a float constant for a literal index, since a
        // TypeScript number is a double until something proves otherwise.
        OpKind::ConstFloat(value)
            if value >= 0.0 && value.fract() == 0.0 && value <= f64::from(u32::MAX) =>
        {
            Some(u64::from(value as u32))
        }
        _ => None,
    }
}
