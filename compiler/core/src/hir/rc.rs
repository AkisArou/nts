//! Reference counting: where a reference is claimed and given up.
//!
//! # The convention, in one sentence
//!
//! Every managed value is owned by the function that names it, and every
//! consumption takes its own reference.
//!
//! That makes the rules local, which is the only way to get this right:
//!
//! - A value whose producer already returns a reference — an allocation, a
//!   concatenation, a call — starts owned.
//! - A value read out of somewhere that outlives the read — a field, an element
//!   — is retained at its definition, so it is owned like any other.
//! - A *parameter* is the exception: it is borrowed, never retained on entry and
//!   never released on exit. See below.
//! - Every consumption retains: storing into a field, passing on an edge,
//!   returning. The consumer's reference is its own.
//! - Every value is released where its live range ends.
//!
//! Retains and releases therefore pair up locally, and a mistake in one place
//! cannot be balanced by a mistake in another. Many of the pairs cancel; that is
//! what an optimizer is for, and correctness first is what RFC §9.2 asks of a
//! first implementation.
//!
//! # Releases go on edges, not at the end of blocks
//!
//! A value can be live along one arm of a branch and dead along the other, and
//! "where the live range ends" is then not a block — it is an edge. Releasing at
//! the end of the branching block would free something the other arm reads;
//! releasing at the start of the successor would release twice when that
//! successor has another predecessor where the value is live.
//!
//! So an edge that has releases to place gets a block of its own, holding them
//! and a jump onward. That is the standard critical-edge split, and it is what
//! makes the placement exact rather than conservative — no path leaks and no
//! path releases twice.
//!
//! A terminator with no successors is the simple case: the function is leaving,
//! so everything it still holds is released. The returned value was retained for
//! the return, so what the caller receives survives it.
//!
//! # Parameters are borrowed
//!
//! A callee could retain each managed parameter on entry and release it on exit,
//! which is uniform and costs two atomic operations per argument per call. It is
//! also unnecessary, because the caller is already holding one.
//!
//! The argument is a value the caller owns — that is the invariant this module
//! maintains for every value — and the caller's release for it is placed either
//! at the end of the block containing the call or on an edge leaving that block.
//! Both are strictly after the call returns, and the call is synchronous. So the
//! object cannot reach zero while the callee is running, and the callee needs no
//! reference of its own.
//!
//! What the callee does with the parameter is unaffected. Storing it into a
//! field retains, returning it retains, passing it along an edge retains — the
//! rules above are about consumption, and they do not change. Only the entry
//! retain and the exit release go away, and with them the whole convention of a
//! function taking a reference just to give it back.
//!
//! This is the one place where correctness rests on an argument about the caller
//! rather than on a local rule, which is why it is spelled out rather than
//! assumed.
//!
//! # Handing a reference on is a move, not a copy
//!
//! A value that is passed on *and* dies where it is passed on does not need a
//! retain and a release: it needs neither. The consumer takes the reference this
//! function was already holding. `return new C()` is the everyday case — retain
//! for the caller, release because the local is dying, both on the same value
//! with nothing in between.
//!
//! Cancelling the pair is safe here for a reason worth stating, because it is
//! not safe in general. Suppose the same edge also releases an object `o` that
//! holds the moved value in a field, and that releasing `o` drops what its
//! fields hold. Without the retain, could the move leave the value at zero
//! before the consumer sees it? No — the store into `o`'s field took its own
//! reference, so the value is held twice and the local's reference is genuinely
//! the local's to give. That is the convention at the top of this module doing
//! the work it exists to do.

use super::liveness;
use super::{BlockId, Func, HirType, Layout, ManagedType, Op, OpKind, Program, ValueId};

/// What one pass inserted.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    pub retains: usize,
    pub releases: usize,
    /// Hand-offs that needed neither, because the consumer took the reference
    /// the function was already holding.
    pub moves: usize,
    /// Loads that needed neither, because the slot they read stayed put.
    pub borrows: usize,
}

/// Insert retains and releases across a program.
/// Which functions can overwrite a slot, directly or through anything they call.
///
/// # Why a borrow needs this
///
/// A reference read out of a slot belongs to that slot, and stays good while
/// the slot still holds it. `borrows_safely` therefore gives up the moment a
/// call falls between a load and its use, and its comment says why: *"Ruling
/// that out needs to know what a callee can reach, which is a larger analysis
/// than this one."* This is that analysis, in the smallest form that answers
/// the question.
///
/// A callee that stores nothing cannot overwrite the slot. It cannot free the
/// container either: under this module's convention a parameter is *borrowed*,
/// so a callee releases only what it owns, and the container is owned by
/// whatever the caller read it from. So "stores nothing, transitively" is
/// exactly the property a borrow needs to survive a call.
///
/// # Why the lattice is a boolean
///
/// `hir::interprocedural` needs widening because a range has infinite height.
/// This has two values, so the least fixpoint from "stores nothing" terminates
/// in at most one pass per edge of the call graph and needs no widening.
///
/// # Where it stays conservative
///
/// A **virtual** call reaches whichever implementation the receiver has, and
/// the receiver is not known here -- so it mutates. An **external** call has no
/// body in this program, so it mutates too. That second one is coarser than it
/// needs to be: the runtime already marks its read-only helpers
/// `NTS_READS_ONLY`, and `hir::runtime` could carry that alongside the types it
/// already carries. Until it does, an external call ends a borrow.
/// What a field is called, which is how two slots are told apart.
///
/// Not by type, and this is the trap: TypeScript here is structurally typed and
/// a subclass that adds storage gets a *different* layout, so `B extends A`
/// gives `FieldSet` on a `B` and `FieldGet` on an `A` different `HirType`s --
/// while they are the same object at run time, with `A`'s fields first and at
/// the same offsets. Comparing types calls that safe and it is not.
///
/// Names answer it: a subclass inherits its base's field names, so one slot has
/// one name however it is viewed. Two unrelated classes that both have an `x`
/// are called a hazard, which loses precision and keeps the answer sound.
fn field_name<'a>(
    func: &Func,
    layouts: &'a [Layout],
    object: ValueId,
    field: u32,
) -> Option<&'a str> {
    let HirType::Managed(ManagedType::Object(id)) = &func.values[object.0 as usize].ty else {
        return None;
    };
    let layout = layouts.iter().find(|layout| layout.types.contains(id))?;
    layout
        .fields
        .get(field as usize)
        .map(|field| field.name.as_str())
}

/// Whether a borrow of this load is good for the whole function.
///
/// `borrows_safely` answers one block at a time and opens with `dies_in`, so a
/// value used after its own block keeps a count however harmless it is. That is
/// most of what `awfy-towers` and `awfy-nbody` still pay: `pushDisk` reads
/// `this.piles` in its first block and writes through it in its last, and
/// `advance` reads `this.bodies` once and uses it all the way down.
///
/// The question those need is not "is this block quiet" but "can *anything*
/// here reach the slot". A store can only name a field of the same index in
/// the same containing type, or -- for an element -- any array at all, because
/// two arrays cannot be told apart here. If no store in the function qualifies
/// and no call mutates, the borrow is good everywhere and the block structure
/// stops mattering.
///
/// # Why the container must be a parameter
///
/// A borrow is alive because its container's slot still holds it, so the
/// container has to be alive for a reason nothing here can affect. A parameter
/// is: the caller holds a reference for the length of the call, and this
/// module never releases one. A value the *function* allocated is not -- it can
/// die here, and the borrow with it.
fn survives_the_function(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    settled: &rustc_hash::FxHashSet<ValueId>,
    unobserved: &rustc_hash::FxHashSet<ValueId>,
    value: ValueId,
) -> bool {
    let (container, from_field) = match &func.values[value.0 as usize].kind {
        OpKind::FieldGet { object, field, .. } => (*object, Some(*field)),
        OpKind::ArrayGet { array, .. } => (*array, None),
        _ => return false,
    };
    // A parameter is alive because the caller holds it. A container that is
    // *itself* a settled borrow is alive for the same reason one step up, and
    // the chain ends at a parameter -- so `bodies[i]` qualifies once `bodies`
    // does, which is the shape `NBodySystem#advance` is made of.
    if !matches!(func.values[container.0 as usize].kind, OpKind::Param(_))
        && !settled.contains(&container)
    {
        return false;
    }
    let ours = from_field.and_then(|field| field_name(func, layouts, container, field));
    !func.values.iter().enumerate().any(|(index, op)| {
        if unobserved.contains(&ValueId(u32::try_from(index).unwrap_or(u32::MAX))) {
            return false;
        }
        match &op.kind {
        OpKind::Call {
            callee: super::Callee::Direct(name),
            ..
        } => mutates.contains(name),
        OpKind::Call { .. } => true,
        OpKind::FieldSet { object, field, .. } => match (ours, from_field) {
            // An element borrow is never a field, and a field slot is named.
            (_, None) => false,
            // A layout this cannot find is a slot it cannot rule out.
            (None, Some(_)) => true,
            (Some(ours), Some(_)) => {
                field_name(func, layouts, *object, *field).is_none_or(|theirs| ours == theirs)
            }
        },
        OpKind::ArraySet { .. } => from_field.is_none(),
        _ => false,
        }
    })
}

/// The borrows that outlive their own block, and the block parameters carrying
/// them.
///
/// A value reaches a later block by being passed as a block *argument*, so the
/// value read there is a different one. If every argument arriving at a
/// parameter is a borrow that needs no count, neither does the parameter --
/// and if any of them is not, the parameter is counted and the edges retain
/// for it as they always did.
///
/// # Which way the fixpoint runs
///
/// Downward. This starts by assuming every candidate *is* a borrow and removes
/// the ones evidence contradicts, and it terminates because the set only
/// shrinks.
///
/// It ran upward first -- assume nothing, add what can be proved -- and that is
/// wrong in a way no amount of seeding fixes. Borrowing is a safety property:
/// it says *nothing on any path kills the anchor*, and a property quantified
/// over all paths is a greatest fixpoint. Started from below, a loop-carried
/// borrow can never be established, because the only justification available is
/// circular: `at` is good if the load `at.next` is, and that load is good if
/// `at` is. Nothing enters that circle from outside it. The obligation to
/// *release*, by contrast, genuinely accumulates and genuinely is a least
/// fixpoint -- the two halves want opposite directions and shared one.
///
/// What keeps the optimism sound is the seed, not the loop. Only function
/// parameters, loads and block parameters are ever candidates. An allocation
/// and a call result are owned and are never in the set, so a block parameter
/// that receives one loses on the first pass and takes its whole circle with
/// it. A load survives only while `survives_the_function` holds, which is a
/// whole-function claim about stores and calls and is not circular at all.
fn crossing_borrows(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
) -> rustc_hash::FxHashSet<ValueId> {
    // Operations in a block that control never leaves. A `throw` lowers to a
    // call and an `Unreachable`, and nothing after it runs -- so whatever it
    // did, nothing observes. Guard clauses are everywhere in real code, and
    // every one of them was ending a borrow for the whole function around it.
    let mut unobserved = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        if matches!(block.terminator, super::Terminator::Unreachable) {
            unobserved.extend(block.ops.iter().copied());
        }
    }

    let mut crossing = rustc_hash::FxHashSet::default();
    if !eliding() {
        return crossing;
    }
    // The seed is the soundness argument. A function parameter is borrowed by
    // this module's own convention -- never retained on entry, never released
    // on exit, because the caller holds it for the length of the call. A load
    // and a block parameter are *candidates*: they may turn out to be borrows,
    // and the loop below decides. Nothing else is ever in the set, which is
    // what stops an allocation or a call result from being assumed away.
    for (index, op) in func.values.iter().enumerate() {
        let value = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
        if (matches!(op.kind, OpKind::Param(_)) || is_load(&op.kind))
            && counted(func, layouts, value)
        {
            crossing.insert(value);
        }
    }
    for block in &func.blocks {
        for param in &block.params {
            if counted(func, layouts, *param) {
                crossing.insert(*param);
            }
        }
    }
    // Loads and block parameters in **one** fixpoint, not two, and running
    // down rather than up. In a loop they depend on each other circularly:
    // `at` is a block parameter carrying `head` and `at.next`, the load is good
    // only if `at` is, and `at` is good only if every argument arriving at it
    // is -- that load included. Asked from below the circle has no entrance;
    // asked from above it survives unless something outside it objects.
    let incoming = super::loops::predecessors(func);
    loop {
        let mut shrank = false;
        let mut doomed: Vec<ValueId> = Vec::new();
        for &value in &crossing {
            if is_load(&func.values[value.0 as usize].kind)
                && !survives_the_function(func, layouts, mutates, &crossing, &unobserved, value)
            {
                doomed.push(value);
            }
        }
        for (at, block) in func.blocks.iter().enumerate() {
            let arriving = &incoming[at];
            if arriving.is_empty() {
                continue;
            }
            for (slot, param) in block.params.iter().enumerate() {
                if crossing.contains(param)
                    && !arriving
                        .iter()
                        .all(|(_, args)| args.get(slot).is_some_and(|arg| crossing.contains(arg)))
                {
                    doomed.push(*param);
                }
            }
        }
        for value in doomed {
            if crossing.remove(&value) {
                shrank = true;
            }
        }
        if !shrank {
            return crossing;
        }
    }
}

/// What a counting decision needs about the world outside the block it is in.
///
/// Two facts that are computed once and read everywhere: which values are live
/// where, and which functions can overwrite a slot. Passed together because
/// they are always wanted together, and because threading them separately put
/// two functions over the argument limit -- which is the lint noticing the same
/// thing.
struct Surroundings<'a> {
    live: &'a liveness::Liveness,
    mutates: &'a rustc_hash::FxHashSet<String>,
    /// Borrows good for the whole function, which therefore cross blocks. See
    /// [`crossing_borrows`]: nothing releases one and no edge retains for one,
    /// so every place that decides either has to agree.
    crossing: &'a rustc_hash::FxHashSet<ValueId>,
}

fn mutating(program: &Program) -> rustc_hash::FxHashSet<String> {
    let mut mutates: rustc_hash::FxHashSet<String> = program
        .funcs
        .iter()
        .filter(|func| {
            func.values.iter().any(|op| {
                matches!(
                    op.kind,
                    OpKind::FieldSet { .. } | OpKind::ArraySet { .. } | OpKind::GlobalSet { .. }
                )
            })
        })
        .map(|func| func.name.clone())
        .collect();

    loop {
        let mut grew = false;
        for func in &program.funcs {
            if mutates.contains(&func.name) {
                continue;
            }
            let reaches = func.values.iter().any(|op| match &op.kind {
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => mutates.contains(name),
                OpKind::Call { .. } => true,
                _ => false,
            });
            if reaches {
                mutates.insert(func.name.clone());
                grew = true;
            }
        }
        if !grew {
            return mutates;
        }
    }
}

pub fn insert(program: &mut Program) -> Report {
    let mut report = Report::default();
    let layouts = program.layouts.clone();
    let mutates = mutating(program);
    for func in &mut program.funcs {
        // Nothing an inert function does can invalidate a borrow, so nothing in
        // it needs a count -- except what leaves. See `inert`.
        let one = if inert(func) {
            count_only_returns(func, &layouts)
        } else {
            insert_into(func, &layouts, &mutates)
        };
        report.retains += one.retains;
        report.releases += one.releases;
        report.moves += one.moves;
        report.borrows += one.borrows;
    }
    report
}

/// A deterministic ordering, so one compiler on one input emits one program.
fn ordered(
    func: &Func,
    layouts: &[Layout],
    values: &rustc_hash::FxHashSet<ValueId>,
) -> Vec<ValueId> {
    let mut counted_values: Vec<ValueId> = values
        .iter()
        .copied()
        .filter(|value| owned(func, layouts, *value))
        .collect();
    counted_values.sort_unstable();
    counted_values
}

/// Whether a value needs counting at all.
///
fn counted(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    let op = &func.values[value.0 as usize];
    if !op.ty.may_hold_a_reference() {
        return false;
    }
    match op.kind {
        // A constant with no count to change.
        //
        // A string is static data the runtime treats as immortal. A null is not
        // an object at all: `nts_retain` and `nts_release` both return
        // immediately for one, so counting it was never *wrong* -- it was an
        // out-of-line call per occurrence to decide nothing, and every
        // `x !== null` inside a loop has one.
        //
        // `List#isShorterThan` is the whole argument for the second: a
        // five-line loop that spent four of its six retains and four of its ten
        // releases on a constant the compiler had just written two lines above
        // as `(NtsObj_Element *)0`.
        // A named function used as a value is one object for the whole program:
        // the C backend emits it `static ... = {{&desc, NTS_IMMORTAL, 0, 0}}`
        // rather than allocating it, and the runtime reads that word and stops.
        // So it was already never counted at *run* time; this stops paying the
        // call to find out.
        OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic => false,
        // A frame object has no count of its own -- it goes away when the frame
        // does, and counting it would at best be wasted work and at worst call
        // `free` on a stack address. But it still *ends*, and if it holds
        // references they have to be given up then. So it is tracked exactly
        // like anything else, and only the release differs.
        OpKind::ObjectNew { frame: true } => !reference_fields(func, layouts, value).is_empty(),
        _ => true,
    }
}

/// The indices of a value's reference fields, in layout order.
fn reference_fields(func: &Func, layouts: &[Layout], value: ValueId) -> Vec<u32> {
    let HirType::Managed(ManagedType::Object(id)) = &func.values[value.0 as usize].ty else {
        return Vec::new();
    };
    let Some(layout) = layouts.iter().find(|layout| layout.types.contains(id)) else {
        return Vec::new();
    };
    layout
        .fields
        .iter()
        .enumerate()
        .filter(|(_, field)| field.ty.may_hold_a_reference())
        .filter_map(|(index, _)| u32::try_from(index).ok())
        .collect()
}

/// Whether this function holds a reference of its own to a value.
///
/// Everything counted is owned except a parameter, which the caller holds for
/// the length of the call. An owned value is retained where it is produced and
/// released where it dies; a borrowed one is neither.
fn owned(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    counted(func, layouts, value) && !matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
}

/// Whether a producer already yields a reference the function owns.
fn produces_owned(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::ObjectNew { .. }
            | OpKind::ArrayNew { .. }
            | OpKind::Call { .. }
            | OpKind::Binary {
                op: super::BinOp::Concat,
                ..
            }
            // A block parameter arrives from an edge, and the edge retained for
            // it. Retaining again here would count one reference twice.
            | OpKind::BlockParam(_)
    )
}

/// Whether to elide at all.
///
/// `NTS_RC_NAIVE=1` turns every elision off and emits the counting a
/// correctness-first implementation would. Nothing else changes: the program
/// still runs and still agrees with node, it simply pays for every reference.
///
/// That is the denominator `tooling/memory` divides by. A count on its own says
/// nothing -- `awfy-bounce` has five reference-counting operations and is one of
/// the worst rows in the table, while `awfy-list` had thirty-eight and is among
/// the best. What says whether the elision is good is the *ratio*, which is what
/// Lobster means when it reports eliminating 95% of them.
fn eliding() -> bool {
    std::env::var_os("NTS_RC_NAIVE").is_none()
}

/// Whether nothing in this function can invalidate a borrow.
///
/// A reference read out of a slot belongs to that slot, and stays good while
/// the slot still holds it and the container still exists. What can break that
/// is a store, a call that might store, or a release. A function containing
/// none of them breaks neither, for its whole body rather than for a stretch of
/// one block -- which is the difference that matters, because the shape this
/// exists for carries its value across a loop's back edge.
///
/// Allocation is excluded too, and not because it invalidates anything: an
/// allocated object is *owned*, and owning one thing means the function has
/// counting to do after all. Excluding it is what makes the answer here "count
/// nothing" rather than "count almost nothing".
///
/// `List#isShorterThan` is the shape: `xTail = xTail.next` in a loop, no store
/// and no call anywhere in it, and sixteen reference-counting operations in a
/// five-line body. Every one of them is unnecessary, and `borrows_safely`
/// cannot say so because it reasons one block at a time.
fn inert(func: &Func) -> bool {
    eliding()
        && func.values.iter().all(|op| match &op.kind {
        OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
        | OpKind::Unary { .. }
        | OpKind::Convert(_)
        | OpKind::Length(_)
        | OpKind::FieldGet { .. }
        | OpKind::ArrayGet { .. }
        | OpKind::GlobalGet(_)
        | OpKind::StringUnitAt { .. } => true,
        // Concatenation allocates. Every other binary is arithmetic or a
        // comparison.
        OpKind::Binary { op, .. } => !matches!(op, super::BinOp::Concat),
        // Everything else stores, calls, allocates, or suspends. `Erase` is
        // here for being a boxing operation rather than for being unsafe.
            _ => false,
        })
}

/// What an inert function still owes: a reference on whatever it hands back.
///
/// Its caller is owed an owned reference, and every value inside was borrowed.
fn count_only_returns(func: &mut Func, layouts: &[Layout]) -> Report {
    let mut report = Report::default();
    let returned: Vec<(usize, ValueId)> = func
        .blocks
        .iter()
        .enumerate()
        .filter_map(|(at, block)| match block.terminator {
            super::Terminator::Return(Some(value)) => Some((at, value)),
            _ => None,
        })
        .filter(|(_, value)| counted(func, layouts, *value))
        .collect();

    let mut blocks = std::mem::take(&mut func.blocks);
    for (at, value) in returned {
        let mut ops = std::mem::take(&mut blocks[at].ops);
        retain(func, &mut ops, value, &mut report);
        blocks[at].ops = ops;
    }
    func.blocks = blocks;
    report
}

/// Everything about a function that is settled before a single count is placed.
///
/// Read here rather than in the loop below because `insert_into` takes the
/// blocks out of the function to rebuild them, so `func.blocks` is empty for
/// the rest of it -- and an edge still has to ask what its successor receives.
struct Ambient {
    live: liveness::Liveness,
    crossing: rustc_hash::FxHashSet<ValueId>,
    /// The parameters of each block, by block.
    receives: Vec<Vec<ValueId>>,
}

fn ambient(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
) -> Ambient {
    Ambient {
        live: liveness::analyze(func),
        crossing: crossing_borrows(func, layouts, mutates),
        receives: func
            .blocks
            .iter()
            .map(|block| block.params.clone())
            .collect(),
    }
}

// Over the line, and split further it would read worse. What follows is one
// decision made twice: what a block owes when it leaves the function, and what
// it owes on each edge. They share `moved`, `borrowed` and `crossing`, and
// separating them puts three sets through a signature to keep two halves of one
// rule apart.
#[allow(clippy::too_many_lines)]
fn insert_into(
    func: &mut Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
) -> Report {
    let mut report = Report::default();
    let Ambient {
        live,
        crossing,
        receives,
    } = ambient(func, layouts, mutates);
    let around = Surroundings {
        live: &live,
        mutates,
        crossing: &crossing,
    };
    let blocks = std::mem::take(&mut func.blocks);
    let mut rebuilt = Vec::with_capacity(blocks.len());
    // Blocks created to hold an edge's releases. Appended after the originals,
    // so the ids of those do not move.
    let mut split_blocks: Vec<super::Block> = Vec::new();
    let original_count = blocks.len();

    for (index, block) in blocks.into_iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        let Counted {
            mut ops,
            moved,
            borrowed,
        } = count_ops(
            func,
            layouts,
            at,
            &block.ops,
            &block.terminator,
            &around,
            &mut report,
        );

        let edges = edges_of(&block.terminator);
        let mut terminator = block.terminator.clone();

        if edges.is_empty() {
            // Leaving the function. What is returned is handed to the caller and
            // everything else is dropped -- and a value that is both is moved.
            let mut dying = ordered(func, layouts, live.available(at));
            dying.retain(|value| {
                !moved.contains(value) && !borrowed.contains(value) && !crossing.contains(value)
            });
            let transfers: Vec<ValueId> = super::operands_of_terminator(&block.terminator)
                .into_iter()
                .filter(|value| counted(func, layouts, *value))
                .collect();
            for value in settle(&transfers, &mut dying) {
                retain(func, &mut ops, value, &mut report);
            }
            for value in dying {
                release_value(func, layouts, &mut ops, value, &mut report);
            }
        } else {
            // With one edge it cannot be critical, so its work can go at the end
            // of this block; with more, each edge needs a block of its own.
            let single = edges.len() == 1;
            for (slot, (successor, args)) in edges.into_iter().enumerate() {
                let mut dying: Vec<ValueId> = ordered(func, layouts, live.available(at))
                    .into_iter()
                    .filter(|value| {
                        !live.live_in(successor).contains(value)
                            && !moved.contains(value)
                            && !borrowed.contains(value)
                            && !crossing.contains(value)
                    })
                    .collect();
                // An edge hands its argument to a parameter, and a parameter
                // that is itself a crossing borrow keeps no count -- so
                // retaining for it would be a reference nothing gives back.
                let landed = &receives[successor.0 as usize];
                let transfers: Vec<ValueId> = args
                    .into_iter()
                    .enumerate()
                    .filter(|(slot, value)| {
                        counted(func, layouts, *value)
                            && !landed.get(*slot).is_some_and(|param| crossing.contains(param))
                    })
                    .map(|(_, value)| value)
                    .collect();
                let retains = settle(&transfers, &mut dying);
                if retains.is_empty() && dying.is_empty() {
                    continue;
                }
                let mut edge_ops = Vec::new();
                if single {
                    for value in retains {
                        retain(func, &mut ops, value, &mut report);
                    }
                    for value in dying {
                        release_value(func, layouts, &mut ops, value, &mut report);
                    }
                } else {
                    for value in retains {
                        retain(func, &mut edge_ops, value, &mut report);
                    }
                    for value in dying {
                        release_value(func, layouts, &mut edge_ops, value, &mut report);
                    }
                    let landing = BlockId(
                        u32::try_from(original_count + split_blocks.len()).unwrap_or(u32::MAX),
                    );
                    // The arguments travel with the jump, so the split block
                    // forwards exactly what the edge carried.
                    let args = retarget(&mut terminator, slot, landing);
                    split_blocks.push(super::Block {
                        params: Vec::new(),
                        ops: edge_ops,
                        terminator: super::Terminator::Jump {
                            target: successor,
                            args,
                        },
                    });
                }
            }
        }

        rebuilt.push(super::Block {
            params: block.params,
            ops,
            terminator,
        });
    }

    rebuilt.extend(split_blocks);
    func.blocks = rebuilt;
    report
}

/// The edges leaving a block, each with the arguments it carries.
///
/// Arguments belong to an edge and not to the terminator: a branch's two arms
/// pass different things, and where a value's reference goes depends on which
/// arm runs. A `Branch` condition is a `bool` and so is never counted, which is
/// why it does not appear here.
fn edges_of(terminator: &super::Terminator) -> Vec<(BlockId, Vec<ValueId>)> {
    match terminator {
        super::Terminator::Jump { target, args } => vec![(*target, args.clone())],
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (*then_target, then_args.clone()),
            (*else_target, else_args.clone()),
        ],
        super::Terminator::Return(_)
        | super::Terminator::Unreachable
        | super::Terminator::FellThrough => Vec::new(),
    }
}

/// One block's operations, with counting inserted around them.
fn count_ops(
    func: &mut Func,
    layouts: &[Layout],
    at: BlockId,
    original: &[ValueId],
    terminator: &super::Terminator,
    around: &Surroundings<'_>,
    report: &mut Report,
) -> Counted {
    let mut ops = Vec::with_capacity(original.len());
    let mut fresh = Fresh::entering(func, at);
    let mut moved = rustc_hash::FxHashSet::default();
    let mut borrowed = rustc_hash::FxHashSet::default();

    for (index, value) in original.iter().enumerate() {
        let kind = func.values[value.0 as usize].kind.clone();

        // A store takes its own reference to what it stores, and gives up the
        // one the slot was already holding.
        //
        // The order is load-old, retain-new, store, release-old, and it is that
        // order for one reason: `o.x = o.x` must not free the object between
        // reading it and writing it back. Releasing after the store makes the
        // self-assignment a no-op instead of a use-after-free.
        //
        // A store writing over a zero skips the load and the release: there is
        // nothing in the slot to give up. Every store an object literal or a
        // constructor makes is one of those.
        if let OpKind::FieldSet { value: stored, .. }
        | OpKind::ArraySet { value: stored, .. }
        | OpKind::GlobalSet { value: stored, .. } = &kind
            && counted(func, layouts, *stored)
        {
            let previous = if fresh.initializing(func, &kind) {
                None
            } else {
                load_slot(func, &mut ops, &kind)
            };
            // Storing is a hand-off like any other, so it can be a move: if the
            // value dies in this block it will be released at the end of it, and
            // the slot may as well take the reference the local was holding.
            //
            // At most one store per value claims the death, and it claims it
            // before the terminator gets a chance to -- which is why `moved` is
            // subtracted from the dying set before transfers are settled. Two
            // consumers cancelling against one death would release once and
            // hand out two references.
            // `owned` is not redundant with `dies_in`. A parameter is borrowed,
            // so it is never in a release set at all -- there is no release to
            // cancel against, and skipping the retain would hand the slot a
            // reference the caller is still counting as its own.
            // A *frame* object has no count to hand over, and no store can
            // take over the duty of giving its fields back.
            //
            // Its storage ends with the frame whatever points at it -- escape
            // analysis is what guarantees nothing outlives it -- so a retain
            // would change nothing and a move would be a lie. Treating it as
            // moved dropped the duty on the floor: the container's own release
            // loads the field and releases the *pointer*, which returns
            // immediately for an immortal object, and the references the frame
            // object was holding were never given up. A cell holding a string,
            // captured by a closure, leaked the string exactly this way.
            if matches!(
                func.values[stored.0 as usize].kind,
                OpKind::ObjectNew { frame: true }
            ) {
                // Neither: its fields are released where its frame ends.
            } else if owned(func, layouts, *stored)
                && around.live.dies_in(at, *stored)
                && moved.insert(*stored)
            {
                report.moves += 1;
            } else {
                retain(func, &mut ops, *stored, report);
            }
            fresh.observe(func, *value, &kind);
            ops.push(*value);
            if let Some(previous) = previous {
                release(func, &mut ops, previous, report);
            }
            continue;
        }
        fresh.observe(func, *value, &kind);

        ops.push(*value);

        // A producer that hands back a borrow is retained, so that every value
        // this function owns is owned the same way -- unless the borrow is
        // demonstrably good for as long as it is used, in which case the
        // function can just read the slot.
        if owned(func, layouts, *value) && !produces_owned(&kind) {
            if is_load(&kind)
                && (around.crossing.contains(value)
                    || borrows_safely(func, original, index, *value, at, terminator, around))
            {
                borrowed.insert(*value);
                report.borrows += 1;
            } else {
                retain(func, &mut ops, *value, report);
            }
        }
    }
    Counted {
        ops,
        moved,
        borrowed,
    }
}

/// What counting one block produced.
struct Counted {
    ops: Vec<ValueId>,
    /// Values handed to a slot, which claimed their death.
    moved: rustc_hash::FxHashSet<ValueId>,
    /// Values read out of a slot that stayed put, so no reference was taken and
    /// none is given back.
    borrowed: rustc_hash::FxHashSet<ValueId>,
}

/// Reading a reference out of a slot.
///
/// A global is a slot like a field is, and the strongest case of the rule: it
/// outlives every function, so a reference read out of one is owned by the
/// global and not by the reader.
fn is_load(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::FieldGet { .. } | OpKind::ArrayGet { .. } | OpKind::GlobalGet(_)
    )
}

/// Whether a load can read the slot rather than take a reference of its own.
///
/// # The argument
///
/// The reference this produces belongs to the slot it came out of, and the
/// container of that slot is alive here -- it is an operand of the load, and
/// this function owns it or borrows it from someone who does. So the value is
/// good for as long as the slot still holds it and the container still exists.
///
/// Both hold across a stretch of straight-line code with no call, no store and
/// no release in it: nothing can run that would overwrite the slot, nothing here
/// overwrites it, and nothing gives up the container. So a load whose last use
/// falls inside such a stretch needs no retain, and therefore no release.
///
/// # What it turns down
///
/// A value used *by* a call, which is the common `o.field.method()`. The callee
/// could reach the container by some path this does not track and overwrite the
/// slot, and the borrowed reference would be the only thing holding what used to
/// be there. Ruling that out needs to know what a callee can reach, which is a
/// larger analysis than this one; passing an owned reference is what it costs
/// not to have it.
///
/// A value that outlives the block, for the same reason as the rest of this
/// module: what happens on the far side of an edge is not something a local rule
/// gets to assume.
fn borrows_safely(
    func: &Func,
    original: &[ValueId],
    at: usize,
    value: ValueId,
    block: BlockId,
    terminator: &super::Terminator,
    around: &Surroundings<'_>,
) -> bool {
    if !eliding() || !around.live.dies_in(block, value) {
        return false;
    }
    // Handed on by the terminator, so its reference goes somewhere.
    if super::operands_of_terminator(terminator).contains(&value) {
        return false;
    }

    let mut last = at;
    for (index, other) in original.iter().enumerate().skip(at + 1) {
        if super::verify::operands(&func.values[other.0 as usize].kind).contains(&value) {
            last = index;
        }
    }

    !original[at + 1..=last].iter().any(|other| {
        match &func.values[other.0 as usize].kind {
            // A callee that stores nothing, anywhere it can reach, cannot
            // overwrite the slot this was read from -- see `mutating`.
            OpKind::Call {
                callee: super::Callee::Direct(name),
                ..
            } => around.mutates.contains(name),
            OpKind::Call { .. } => true,
            // A store *into* this value cannot invalidate it. It overwrites a
            // slot inside the container and leaves the reference that names the
            // container alone: `piles[i] = disk` overwrites an element, and
            // `piles` is still held by the `this.piles` it was read from.
            //
            // What a store *can* invalidate is a borrow read from the slot
            // being written -- and that is a different value, which this still
            // refuses because the container of that store is not it.
            //
            // Storing the borrowed value itself is a transfer, and a transfer
            // needs a reference of its own however the store is aimed.
            OpKind::FieldSet {
                object,
                value: stored,
                ..
            } => *object != value || *stored == value,
            OpKind::ArraySet {
                array,
                value: stored,
                ..
            } => *array != value || *stored == value,
            _ => false,
        }
    })
}

/// Which slots are known to hold nothing yet.
///
/// # Why this is worth an analysis
///
/// Every store to a reference field has to give up what the slot was holding,
/// and finding that out costs a load, a null test and a call. A store that is
/// *initializing* -- writing over a zero -- owes none of that, and almost every
/// store in a program is one: an object literal writes each field once, an array
/// literal writes each element once, and a constructor writes every field of an
/// object `new` allocated a moment earlier. Paying for the general case
/// everywhere would make a class with reference fields cost several times what
/// it should.
///
/// # What it knows, and what it does not
///
/// One block at a time, in order, which makes it obviously sound and misses
/// exactly one thing worth naming: a constructor that writes a field from inside
/// an `if` gets no benefit, because the store is not in the entry block. Fixing
/// that is a forward dataflow over the CFG with union at joins -- a slot is
/// known-zero only where it is zero on *every* path -- and the reason it is not
/// here is that a wrong answer does not fail loudly. Too eager and a reference
/// leaks; too eager the other way is worse. Block-local is the version that can
/// be read and believed.
///
/// A reference stops being fresh the moment it is handed to anything that could
/// store through it. Reading a field, reading an element and asking for a length
/// are not that; a call, a store, an edge and a return are.
#[derive(Debug, Default)]
struct Fresh {
    /// Objects and arrays whose slots this block still knows about.
    bases: rustc_hash::FxHashSet<ValueId>,
    /// Slots already written, so the second store to one is not initializing.
    written: rustc_hash::FxHashSet<(ValueId, u64)>,
}

impl Fresh {
    /// What is known on entry to a block.
    fn entering(func: &Func, block: BlockId) -> Self {
        let mut fresh = Self::default();
        // A constructor's receiver arrives freshly allocated. Only in the entry
        // block: a later block may be reached by a path that already wrote.
        // Parameter `i` is value `i`, which the whole backend relies on -- but
        // it is checked here rather than assumed, because being wrong about
        // which value the receiver is would mean treating some other object's
        // stores as initializing.
        if func.initializes_receiver
            && block == BlockId(0)
            && matches!(
                func.values.first().map(|op| &op.kind),
                Some(OpKind::Param(0))
            )
        {
            fresh.bases.insert(ValueId(0));
        }
        fresh
    }

    /// Whether this store is writing over a zero.
    fn initializing(&self, func: &Func, store: &OpKind) -> bool {
        match store {
            OpKind::FieldSet { object, field, .. } => {
                self.bases.contains(object) && !self.written.contains(&(*object, u64::from(*field)))
            }
            OpKind::ArraySet { array, index, .. } => {
                self.bases.contains(array)
                    && slot_of(func, *index)
                        .is_some_and(|slot| !self.written.contains(&(*array, slot)))
            }
            _ => false,
        }
    }

    /// Take an operation into account.
    fn observe(&mut self, func: &Func, value: ValueId, kind: &OpKind) {
        match kind {
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } => {
                self.bases.insert(value);
            }
            OpKind::FieldSet { object, field, .. } => {
                self.written.insert((*object, u64::from(*field)));
            }
            OpKind::ArraySet { array, index, .. } => match slot_of(func, *index) {
                Some(slot) => {
                    self.written.insert((*array, slot));
                }
                // An index this pass cannot name could be any of them, so the
                // whole array stops being something it knows about.
                None => {
                    self.bases.remove(array);
                }
            },
            _ => {}
        }
        for escaped in escaping_operands(kind) {
            self.bases.remove(&escaped);
        }
    }
}

/// The operands an operation hands to something that could store through them.
///
/// Reading through a reference is not handing it anywhere, which is why the
/// container of a load is absent and the value of a store is present.
fn escaping_operands(kind: &OpKind) -> Vec<ValueId> {
    match kind {
        OpKind::FieldGet { .. } | OpKind::Length(_) => Vec::new(),
        OpKind::ArrayGet { index, .. } => vec![*index],
        OpKind::FieldSet { value, .. } => vec![*value],
        OpKind::ArraySet { index, value, .. } => vec![*index, *value],
        other => super::verify::operands(other),
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
fn slot_of(func: &Func, index: ValueId) -> Option<u64> {
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

/// Read what a slot holds, so that the store about to overwrite it can give up
/// the reference it was keeping.
///
/// The load takes over the slot's reference rather than making one of its own --
/// a move, like every other hand-off here -- so it is not retained, and the
/// release that follows the store is what consumes it.
///
/// An element load carries the same bounds test as the store, on the same array
/// and the same index. If the index is out of range the load traps where the
/// store would have, which is the same program. If bounds elimination can prove
/// the store safe, it proves the load safe by the same facts.
fn load_slot(func: &mut Func, ops: &mut Vec<ValueId>, store: &OpKind) -> Option<ValueId> {
    let (kind, ty, origin) = match store {
        OpKind::FieldSet {
            object,
            field,
            value,
        } => (
            OpKind::FieldGet {
                object: *object,
                field: *field,
            },
            func.values[value.0 as usize].ty.clone(),
            func.values[value.0 as usize].origin.clone(),
        ),
        // A global is never "initializing": `module#init` writes over the
        // static's initial value, and every later store writes over whatever
        // the last one left. So the load and the release always happen, and
        // giving up an absent value has to be free -- which it is, because
        // releasing a null pointer and releasing an `undefined` tag are both
        // defined to do nothing.
        OpKind::GlobalSet { global, value } => (
            OpKind::GlobalGet(*global),
            func.values[value.0 as usize].ty.clone(),
            func.values[value.0 as usize].origin.clone(),
        ),
        OpKind::ArraySet {
            array,
            index,
            value,
            checked,
        } => (
            OpKind::ArrayGet {
                array: *array,
                index: *index,
                checked: *checked,
            },
            func.values[value.0 as usize].ty.clone(),
            func.values[value.0 as usize].origin.clone(),
        ),
        _ => return None,
    };
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op { kind, ty, origin });
    ops.push(id);
    Some(id)
}

/// Cancel each transfer against a death of the same value, leaving the transfers
/// that still need a retain. What is cancelled is a move.
fn settle(transfers: &[ValueId], dying: &mut Vec<ValueId>) -> Vec<ValueId> {
    let mut retains = Vec::new();
    for value in transfers {
        if let Some(at) = dying.iter().position(|d| d == value) {
            // Passed on and dying here: the consumer takes the reference this
            // function already holds, so neither operation is emitted. One
            // death cancels one transfer, which is what makes `f(v, v)` right.
            dying.remove(at);
        } else {
            retains.push(*value);
        }
    }
    retains
}

/// Send one edge through a new block, and hand back the arguments it carried.
///
/// The arguments move to the new block's jump: they are read where control
/// actually leaves, and the values are still available there because the block
/// they came from dominates it. The edge is named by position rather than by
/// target, because a branch can name one block on both arms and those two edges
/// are not interchangeable.
fn retarget(terminator: &mut super::Terminator, slot: usize, to: BlockId) -> Vec<ValueId> {
    match terminator {
        super::Terminator::Jump { target, args } => {
            *target = to;
            std::mem::take(args)
        }
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            if slot == 0 {
                *then_target = to;
                std::mem::take(then_args)
            } else {
                *else_target = to;
                std::mem::take(else_args)
            }
        }
        super::Terminator::Return(_)
        | super::Terminator::Unreachable
        | super::Terminator::FellThrough => Vec::new(),
    }
}

fn retain(func: &mut Func, ops: &mut Vec<ValueId>, value: ValueId, report: &mut Report) {
    let origin = func.values[value.0 as usize].origin.clone();
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Retain(value),
        ty: HirType::Void,
        origin,
    });
    ops.push(id);
    report.retains += 1;
}

/// Give up what a value holds, at the point its live range ends.
///
/// For a heap object that is one call, and the runtime walks the fields. A frame
/// object has no count to reach zero and no destruction to trigger, so the walk
/// is emitted here instead: load each reference field and release it. Same work,
/// decided at compile time rather than read off a descriptor at run time.
fn release_value(
    func: &mut Func,
    layouts: &[Layout],
    ops: &mut Vec<ValueId>,
    value: ValueId,
    report: &mut Report,
) {
    if !matches!(
        func.values[value.0 as usize].kind,
        OpKind::ObjectNew { frame: true }
    ) {
        release(func, ops, value, report);
        return;
    }
    let origin = func.values[value.0 as usize].origin.clone();
    for field in reference_fields(func, layouts, value) {
        let ty = field_type(func, layouts, value, field);
        let loaded = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
        func.values.push(Op {
            kind: OpKind::FieldGet {
                object: value,
                field,
            },
            ty,
            origin: origin.clone(),
        });
        ops.push(loaded);
        release(func, ops, loaded, report);
    }
}

/// The declared type of one field, so the load that reads it is typed.
fn field_type(func: &Func, layouts: &[Layout], value: ValueId, field: u32) -> HirType {
    let HirType::Managed(ManagedType::Object(id)) = &func.values[value.0 as usize].ty else {
        return HirType::Void;
    };
    layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .and_then(|layout| layout.fields.get(field as usize))
        .map_or(HirType::Void, |field| field.ty.clone())
}

fn release(func: &mut Func, ops: &mut Vec<ValueId>, value: ValueId, report: &mut Report) {
    let origin = func.values[value.0 as usize].origin.clone();
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Release(value),
        ty: HirType::Void,
        origin,
    });
    ops.push(id);
    report.releases += 1;
}
