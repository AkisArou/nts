//! Where a value is last used in a block: the operation `rc` releases it
//! after, and the operation the slot model (`contents::slots`) charges with
//! that release where giving the value up can run program code.
//!
//! One walk answers both questions. `rc` asks it with ownership settled
//! ([`Holding::Settled`]), and places each release after the answer. The
//! slot model runs before ownership exists, so it asks with every choice
//! ownership could make still open ([`Holding::Unsettled`]); what it is told
//! is then never earlier than where `rc` will put the release. Each
//! extension of what a use is -- a borrowed load, a view, a block parameter,
//! a frame name, a container -- reaches both, so the placement and the
//! charge cannot drift apart.
//!
//! "Reads it" is wider than an operand. A borrowed load out of the value, an
//! erased or converted view of it, a raw pointer into its storage: each holds
//! no count, and each is only valid while the value is. So the last use is the
//! last operation reading the value *or anything leaning on it*, followed
//! through every value that holds no count of its own ([`Leaning`]).

use crate::hir::liveness;
use crate::hir::own::{self, Ownership};
use crate::hir::{Func, HirType, OpKind, ValueId};

type Values = rustc_hash::FxHashMap<ValueId, Vec<ValueId>>;

/// What a walk knows about who holds a count.
#[derive(Clone, Copy)]
pub(in crate::hir) enum Holding<'a> {
    /// Ownership is settled, and `rc` has decided this block's moves.
    Settled {
        map: &'a own::Map,
        /// Values a store or a consuming call claimed the death of.
        moved: &'a rustc_hash::FxHashSet<ValueId>,
        /// Values an erasure took the reference of, with the erased value now
        /// holding it: what leans on the one leans on the other from there.
        repackaged: &'a rustc_hash::FxHashMap<ValueId, ValueId>,
    },
    /// Nothing is settled. Any value that is not a scalar copy may hold no
    /// count, any store may be a move, and any erasure may repackage.
    Unsettled,
}

/// The frame objects each value is another name for -- through a block
/// parameter, an erasure -- as liveness keeps them live
/// (`liveness::object_names_with`).
///
/// **A read of a name is a read of the object, inside a block too.** Liveness
/// keeps a frame object live into every block a name for it reaches, and
/// `release_at_last_use` then found no read of the object itself there and
/// released it on entry: a cell captured by a `forEach` callback and carried
/// through a later loop's block parameters had its string released at the
/// walk's exit, before the read through the parameter that concatenated it
/// (the Chromium lane's live-list vectors, 2026-10-07).
///
/// A callee whose stores are not known (`stores` answers `None`) may store
/// any argument into any other, so asking with none known names a superset.
pub(in crate::hir) fn frame_names(
    func: &Func,
    stores: &liveness::CalleeStores<'_>,
) -> Result<Values, liveness::Failure> {
    Ok(liveness::object_names_with(func, stores)?
        .into_iter()
        .filter_map(|(name, roots)| {
            let framed: Vec<ValueId> = roots
                .into_iter()
                .filter(|root| {
                    matches!(
                        func.values[root.0 as usize].kind,
                        OpKind::ObjectNew { frame: true }
                    )
                })
                .collect();
            (!framed.is_empty()).then_some((name, framed))
        })
        .collect())
}

/// Every block parameter, with the arguments each edge into it carries.
pub(in crate::hir) fn arriving(func: &Func) -> Values {
    let mut arriving = Values::default();
    for block in &func.blocks {
        for (target, args) in super::edges_of(&block.terminator) {
            let Some(params) = func.blocks.get(target.0 as usize).map(|b| &b.params) else {
                continue;
            };
            for (param, argument) in params.iter().zip(args) {
                arriving.entry(*param).or_default().push(argument);
            }
        }
    }
    arriving
}

/// What a value leans on: itself, and -- where it holds no count of its own
/// and can point at memory -- everything its definition read, followed
/// through. A borrowed field load leans on the object it was loaded from; an
/// erased or converted view on what it views; a block parameter that holds no
/// count on every argument an edge hands it.
///
/// A number or a boolean is a copy and leans on nothing, which also keeps
/// arithmetic from dragging a whole computation's history along.
pub(in crate::hir) struct Leaning<'a, 'f> {
    func: &'f Func,
    holding: Holding<'a>,
    arriving: &'a Values,
    /// Values a store in this block moved into a container, with the
    /// containers.
    ///
    /// A store that claimed a value's death moved the local's reference into
    /// the container, and the local may still be read after it: `first` in
    /// `each_upto((n) => { first += n }); return first + second` is a cell
    /// moved into the closure and read after the call. From the move on, the
    /// value is the container's, so it leans on the container.
    moved_into: Values,
    /// The other direction, for a **frame** container only: what a store put
    /// into it, by container.
    ///
    /// `moved_into` answers "the content is needed later, so do not release the
    /// container", which is the case its comment describes -- a cell moved into
    /// a closure and read *directly* after the call. This answers the reverse,
    /// and nothing did: **the container is read later, so do not release what is
    /// in it.**
    ///
    /// ```ts
    /// const root = new Root();               // frame-local
    /// const one = (tag: string) => make(root, tag);
    /// const two = (tag: string) => make(root, tag);
    /// console.log(one("a"));                 // reads root.names
    /// ```
    ///
    /// `root`'s last op*erand* use is the store into the second closure, so it
    /// was judged dead there and `release_value` gave up its fields -- freeing
    /// `root.names` before either closure ran. The React lane reduced it: node
    /// prints `a2 b21 c2` and the compiled program printed `a2 b11 c1`.
    ///
    /// **Only where the store transfers no count**, because that is where the
    /// hole is: a store of a heap value into a heap container took a count, so
    /// the content cannot reach zero while the container holds it. A frame
    /// container has no count to give, and a frame object has none to take --
    /// that is what `release_value`'s own doc says it exists for -- so the
    /// store transfers nothing and the liveness has to say what the count would
    /// have.
    ///
    /// The second half arrived with acyclic arrays (a2fe27266): an array whose
    /// elements cannot form a cycle is never buffered, so escape analysis lets
    /// a tuple stored in a non-escaping array stay in the frame. The array is
    /// on the heap and its store is a retain of an immortal header, so the
    /// tuple's fields were given up at the tuple's last use while the array
    /// still reached it: `for (const [a, [b, c]] of rows)` read a freed inner
    /// array (tests/programs/a-for-of-head-that-destructures under RC).
    holds: Values,
    memo: rustc_hash::FxHashMap<ValueId, std::rc::Rc<[ValueId]>>,
}

impl<'a, 'f> Leaning<'a, 'f> {
    /// What leans on what in a block whose operations are `ops`. Unsettled,
    /// every store is a move and transfers no count, and every erasure
    /// repackages.
    pub(in crate::hir) fn new(
        func: &'f Func,
        holding: Holding<'a>,
        arriving: &'a Values,
        ops: &[ValueId],
    ) -> Self {
        let frame = |value: &ValueId| {
            matches!(
                func.values[value.0 as usize].kind,
                OpKind::ObjectNew { frame: true }
            )
        };
        let mut moved_into = Values::default();
        let mut holds = Values::default();
        for op in ops {
            if let OpKind::FieldSet {
                object: container,
                value,
                ..
            }
            | OpKind::ArraySet {
                array: container,
                value,
                ..
            } = &func.values[op.0 as usize].kind
            {
                let (moved, uncounted) = match holding {
                    Holding::Settled { moved, .. } => {
                        (moved.contains(value), frame(container) || frame(value))
                    }
                    Holding::Unsettled => (true, true),
                };
                if moved {
                    moved_into.entry(*value).or_default().push(*container);
                }
                if uncounted {
                    holds.entry(*container).or_default().push(*value);
                }
            }
        }
        match holding {
            Holding::Settled { repackaged, .. } => {
                for (source, erased) in repackaged {
                    moved_into.entry(*source).or_default().push(*erased);
                }
            }
            Holding::Unsettled => {
                for op in ops {
                    if let Some(source) = super::another_name_for(&func.values[op.0 as usize].kind)
                    {
                        moved_into.entry(source).or_default().push(*op);
                    }
                }
            }
        }
        Self {
            func,
            holding,
            arriving,
            moved_into,
            holds,
            memo: rustc_hash::FxHashMap::default(),
        }
    }

    pub(in crate::hir) fn of(&mut self, value: ValueId) -> std::rc::Rc<[ValueId]> {
        if let Some(known) = self.memo.get(&value) {
            return known.clone();
        }
        let found = self.walk(vec![value]);
        self.memo.insert(value, found.clone());
        found
    }

    /// What a value's definition leans on, whatever the value holds: what
    /// it read, and what those lean on.
    fn definition(&mut self, value: ValueId) -> std::rc::Rc<[ValueId]> {
        self.walk(self.sources(value))
    }

    fn walk(&self, mut stack: Vec<ValueId>) -> std::rc::Rc<[ValueId]> {
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(next) = stack.pop() {
            if !seen.insert(next) {
                continue;
            }
            if let Some(containers) = self.moved_into.get(&next) {
                stack.extend(containers.iter().copied());
            }
            // And what a frame container holds: reading the container is a use
            // of everything in it, because the fields are given up when *it*
            // dies. See `holds`.
            if let Some(contents) = self.holds.get(&next) {
                stack.extend(contents.iter().copied());
            }
            if self.holds_nothing(next) {
                stack.extend(self.sources(next));
            }
        }
        let mut found: Vec<ValueId> = seen.into_iter().collect();
        found.sort_unstable();
        found.into()
    }

    /// What a value was made from: its operation's operands, or what every
    /// edge hands it where it is a block parameter.
    fn sources(&self, value: ValueId) -> Vec<ValueId> {
        let op = &self.func.values[value.0 as usize];
        if matches!(op.kind, OpKind::Param(_)) {
            return Vec::new();
        }
        match self.arriving.get(&value) {
            Some(arguments) => arguments.clone(),
            None => crate::hir::operands_of(&op.kind),
        }
    }

    /// Whether a value is only valid while something else is: it holds no
    /// count, and is not a scalar copy. Unsettled, any value that is not a
    /// scalar copy may be one.
    fn holds_nothing(&self, value: ValueId) -> bool {
        let scalar = matches!(
            self.func.values[value.0 as usize].ty,
            HirType::Void
                | HirType::Never
                | HirType::Bool
                | HirType::Int { .. }
                | HirType::Float { .. }
        );
        !scalar
            && match self.holding {
                Holding::Settled { map, .. } => {
                    map.borrowed(value)
                        || matches!(map.of(value), Ownership::Unowned | Ownership::Borrowed)
                }
                Holding::Unsettled => true,
            }
    }
}

/// What `op` reads, as a release's placement asks it: the op itself, what each
/// operand leans on, a retain's definition -- a value loaded out of something
/// is still that thing's until its retain, and `x = o.f; release o; retain x`
/// retains freed memory -- and, for each, the frame objects it is another name
/// for ([`frame_names`]): `x = c.value; release the cell; retain x` is the same
/// hazard when `c` is a block parameter naming a frame cell (a captured `let`
/// passed to a closure after an inlined `forEach`, the Chromium lane's second
/// live-list vector).
pub(in crate::hir) fn reads_of(
    leaning: &mut Leaning<'_, '_>,
    frame_names: &Values,
    op: ValueId,
) -> Vec<ValueId> {
    let mut read = vec![op];
    let kind = &leaning.func.values[op.0 as usize].kind;
    let mut held: Vec<ValueId> = Vec::new();
    if let OpKind::Retain(retained) = kind {
        held.extend(leaning.definition(*retained).iter().copied());
    }
    for operand in crate::hir::operands_of(kind) {
        held.extend(leaning.of(operand).iter().copied());
    }
    for value in held {
        read.push(value);
        read.extend(frame_names.get(&value).into_iter().flatten().copied());
    }
    read
}

/// Backward over a block's `ops`: the first operation met that reads a
/// pending value, or defines it, is its last use. Each value claimed is
/// listed under the position of that operation.
pub(in crate::hir) fn last_uses(
    leaning: &mut Leaning<'_, '_>,
    frame_names: &Values,
    ops: &[ValueId],
    pending: &mut rustc_hash::FxHashSet<ValueId>,
) -> rustc_hash::FxHashMap<usize, Vec<ValueId>> {
    let mut last: rustc_hash::FxHashMap<usize, Vec<ValueId>> = rustc_hash::FxHashMap::default();
    for index in (0..ops.len()).rev() {
        if pending.is_empty() {
            break;
        }
        for value in reads_of(leaning, frame_names, ops[index]) {
            if pending.remove(&value) {
                last.entry(index).or_default().push(value);
            }
        }
    }
    last
}

/// The position a release of what was last used at `index` follows.
///
/// Nothing runs between a call a region serves and its end (`regions`): what
/// dies at the call is released after the end, or the free would land inside
/// the region's window -- counted as the region's, and given back twice by its
/// reset.
pub(in crate::hir) fn released_after(func: &Func, ops: &[ValueId], index: usize) -> usize {
    match ops.get(index + 1) {
        Some(next) if crate::hir::regions::ends_a_call(&func.values[next.0 as usize].kind) => {
            index + 1
        }
        _ => index,
    }
}
