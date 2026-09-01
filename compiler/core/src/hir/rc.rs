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
/// # What the container may be
///
/// A borrow is alive because its container's slot still holds it, so the
/// container has to be alive for the whole borrow. A parameter is, for free:
/// the caller holds a reference for the length of the call and this module
/// never releases one.
///
/// A value the function allocated is not, for free -- it can die here, and the
/// borrow with it. It can be *made* to be, which is what [`entry_owned`] and
/// `hold_to_every_exit` are between them. That is not a detail: refusing it
/// meant every walk over a list a function built itself paid full price, which
/// `local-anchor` measures at 0 of 85 against `traversal`'s 40% for the same
/// loop over a list handed in as a parameter.
/// What a borrow stands on: what may anchor it, and what can still run after it.
///
/// `settled` and `owned` mean opposite things and are both anchors. `settled`
/// holds borrows -- a container that is one is alive for whatever reason its
/// own anchor is. `owned` holds values the frame is keeping anyway, whose live
/// range this pass stretches to every exit so that borrowing from them is safe.
///
/// `reaches` is the other half. A borrow can only be invalidated by something
/// that runs *after* it, so the scan below is over the blocks reachable from
/// the load's own block and not over the whole function.
struct Standing<'a> {
    settled: &'a rustc_hash::FxHashSet<ValueId>,
    owned: &'a rustc_hash::FxHashSet<ValueId>,
    /// Which block defines each value.
    defined_in: &'a [Option<usize>],
    /// Which blocks each block can reach, itself included when it is in a loop.
    reaches: &'a [rustc_hash::FxHashSet<usize>],
}

/// Which block each value is defined in, and which blocks each block reaches.
///
/// The second is a transitive closure over successors, computed once per
/// function. Functions here are small enough that a breadth-first walk per
/// block is cheaper than being clever, and the walk is what `verify` already
/// does with dominators next door.
fn control_flow(func: &Func) -> (Vec<Option<usize>>, Vec<rustc_hash::FxHashSet<usize>>) {
    let mut defined_in = vec![None; func.values.len()];
    for (at, block) in func.blocks.iter().enumerate() {
        for value in block.params.iter().chain(block.ops.iter()) {
            defined_in[value.0 as usize] = Some(at);
        }
    }
    let mut reaches = Vec::with_capacity(func.blocks.len());
    for start in &func.blocks {
        let mut seen = rustc_hash::FxHashSet::default();
        let mut queue = start.terminator.successors();
        while let Some(block) = queue.pop() {
            let at = block.0 as usize;
            if at >= func.blocks.len() || !seen.insert(at) {
                continue;
            }
            queue.extend(func.blocks[at].terminator.successors());
        }
        reaches.push(seen);
    }
    (defined_in, reaches)
}

fn survives_the_function(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    standing: &Standing<'_>,
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
        && !standing.settled.contains(&container)
        && !standing.owned.contains(&container)
    {
        return false;
    }
    let ours = from_field.and_then(|field| field_name(func, layouts, container, field));
    // Only what can run after the load. A borrow is invalidated by a store or a
    // call that happens *later*, and scanning the whole function charged it for
    // everything that happened earlier too -- which is most of a function that
    // builds a structure and then walks it. `local-anchor` builds a list with a
    // call that stores and then walks it with no call at all, and paid for the
    // build on every step of the walk.
    let after = standing
        .defined_in
        .get(value.0 as usize)
        .copied()
        .flatten()
        .map(|at| &standing.reaches[at]);
    !func.values.iter().enumerate().any(|(index, op)| {
        let each = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
        if unobserved.contains(&each) {
            return false;
        }
        // Its own block counts: a loop reaches itself, and on the next time
        // round what came before the load comes after the one before it.
        let theirs = standing.defined_in.get(index).copied().flatten();
        if let (Some(reachable), Some(theirs)) = (after, theirs) {
            let mine = standing.defined_in[value.0 as usize].unwrap_or(theirs);
            if theirs != mine && !reachable.contains(&theirs) {
                return false;
            }
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

/// Owned values the entry block defines.
///
/// The entry block runs exactly once per call, so a value defined there names
/// exactly one object for the whole call -- which is what makes it safe to
/// stretch its live range to every exit and let borrows anchor to it. A value
/// defined in a loop names a different object each time round and cannot: one
/// release at one exit would give back one reference for however many objects
/// the loop made.
///
/// Excludes anything a `Return` hands back. That reference belongs to the
/// caller, and a value both returned and released at the same exit is consumed
/// twice.
///
/// Excludes loads, which are borrow candidates and are anchored by `settled`
/// one step further up instead.
fn entry_owned(func: &Func, layouts: &[Layout]) -> rustc_hash::FxHashSet<ValueId> {
    let returned: rustc_hash::FxHashSet<ValueId> = func
        .blocks
        .iter()
        .filter_map(|block| match block.terminator {
            super::Terminator::Return(Some(value)) => Some(value),
            _ => None,
        })
        .collect();
    let Some(entry) = func.blocks.first() else {
        return rustc_hash::FxHashSet::default();
    };
    entry
        .ops
        .iter()
        .copied()
        .filter(|value| {
            !returned.contains(value)
                && counted(func, layouts, *value)
                && !is_load(&func.values[value.0 as usize].kind)
                // A function parameter is an op in the entry block like any
                // other, and it is the one thing here that must never be
                // released: the caller holds it for the length of the call.
                // Sweeping them in meant every closure's `this` had its live
                // range stretched to the exits and a release emitted there, so
                // `aCellPerIteration` gave 4 where node gives 9 -- a cell freed
                // while it was still being written through.
                //
                // They need no help from this set. `survives_the_function`
                // anchors to a parameter by name, one line above where it asks
                // about `owned` at all.
                && !matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
        })
        .collect()
}

/// The owned values that borrows actually depend on, and so have to be kept.
///
/// Two ways to become one: being the container a settled load reads out of,
/// and being handed to a block parameter that settled. The second is the one
/// that matters for a walk -- the head of a list is passed into the loop and
/// never named again, so without this its reference dies on that edge and the
/// cursor would outlive it.
///
/// Only the ones that are used. Stretching every entry-block value to every
/// exit would delay frees nothing asked to delay and turn moves into copies.
fn anchors(
    func: &Func,
    crossing: &rustc_hash::FxHashSet<ValueId>,
    owned: &rustc_hash::FxHashSet<ValueId>,
) -> rustc_hash::FxHashSet<ValueId> {
    let mut kept = rustc_hash::FxHashSet::default();
    for &value in crossing {
        let container = match &func.values[value.0 as usize].kind {
            OpKind::FieldGet { object, .. } => Some(*object),
            OpKind::ArrayGet { array, .. } => Some(*array),
            _ => None,
        };
        if let Some(container) = container
            && owned.contains(&container)
        {
            kept.insert(container);
        }
    }
    for block in &func.blocks {
        let carries = block.params.iter().any(|param| crossing.contains(param));
        if !carries {
            continue;
        }
        for other in &func.blocks {
            let args = match &other.terminator {
                super::Terminator::Jump { args, .. } => vec![args],
                super::Terminator::Branch {
                    then_args,
                    else_args,
                    ..
                } => vec![then_args, else_args],
                _ => Vec::new(),
            };
            for list in args {
                for (slot, arg) in list.iter().enumerate() {
                    if block
                        .params
                        .get(slot)
                        .is_some_and(|param| crossing.contains(param))
                        && owned.contains(arg)
                    {
                        kept.insert(*arg);
                    }
                }
            }
        }
    }
    kept
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
    owned: &rustc_hash::FxHashSet<ValueId>,
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
    let (defined_in, reaches) = control_flow(func);
    loop {
        let mut shrank = false;
        let mut doomed: Vec<ValueId> = Vec::new();
        let standing = Standing {
            settled: &crossing,
            owned,
            defined_in: &defined_in,
            reaches: &reaches,
        };
        for &value in &crossing {
            if is_load(&func.values[value.0 as usize].kind)
                && !survives_the_function(func, layouts, mutates, &standing, &unobserved, value)
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
                // An argument that is an owned anchor is as good as a
                // borrow: the frame is holding it and this pass keeps it held.
                // Without that, a walk over a list the function built loses its
                // cursor on the entry edge -- the head is an allocation, not a
                // borrow, and every step after it is counted.
                if crossing.contains(param)
                    && !arriving.iter().all(|(_, args)| {
                        args.get(slot)
                            .is_some_and(|arg| crossing.contains(arg) || owned.contains(arg))
                    })
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
    /// Callees that leave an object as fresh as it arrived. See
    /// [`initializing_only`].
    harmless: &'a rustc_hash::FxHashSet<String>,
    /// Callees whose result is one of the arguments the caller passed in. See
    /// [`hands_back_a_parameter`].
    hands_back: &'a rustc_hash::FxHashSet<String>,
    /// Which slots are still zero on entry to each block. See [`freshness`].
    entering: &'a [Fresh],
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
    let harmless = initializing_only(program, &layouts);
    let hands_back = hands_back_a_parameter(program, &layouts);
    for func in &mut program.funcs {
        // Nothing an inert function does can invalidate a borrow, so nothing in
        // it needs a count -- except what leaves. See `inert`.
        let one = if inert(func) {
            count_only_returns(func, &layouts, &hands_back)
        } else {
            insert_into(func, &layouts, &mutates, &harmless, &hands_back)
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
    eliding() && func.values.iter().all(|op| quiet(&op.kind))
}

/// Whether one operation can store, call, allocate or suspend.
///
/// The per-operation half of [`inert`], which asks it of a whole function.
/// Extracted because [`taking`] needs the same question of one operation at a
/// time: anything that can run other code can reach any slot.
fn quiet(kind: &OpKind) -> bool {
    match kind {
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
    }
}

/// Callees that leave an object exactly as fresh as it arrived.
///
/// The first column of the per-function summary record 0024 asks for, in its
/// narrowest useful form: a function that writes no reference into any slot,
/// hands the object to nobody, and returns nothing. Every constructor generated
/// for a class whose fields are numbers and nullable references is one.
///
/// It matters because `Fresh` stops tracking an object the moment it is handed
/// to a call, and a constructor is the one call that certainly *only*
/// initializes. So the first real store to a field loaded the slot and released
/// what it found -- which is the null the constructor had just put there. One
/// wasted call per field per object, in every program that allocates: thirty
/// two of `traversal`'s ninety nine, and every operation `store-elsewhere` had
/// left above its floor.
///
/// Conservative on purpose. A call of its own could store the object anywhere,
/// so a function containing one is not here however harmless it looks; that
/// wants the real summary, with escape per argument, and this does not.
fn initializing_only(program: &Program, layouts: &[Layout]) -> rustc_hash::FxHashSet<String> {
    program
        .funcs
        .iter()
        .filter(|func| {
            func.blocks
                .iter()
                .all(|block| !matches!(block.terminator, super::Terminator::Return(Some(_))))
                && func.values.iter().all(|op| match &op.kind {
                    OpKind::FieldSet { value: stored, .. }
                    | OpKind::ArraySet { value: stored, .. } => !counted(func, layouts, *stored),
                    OpKind::GlobalSet { .. } => false,
                    other => quiet(other),
                })
        })
        .map(|func| func.name.clone())
        .collect()
}

/// Runtime helpers that take ownership of an argument, and which one.
///
/// The `consumes` column of record 0024's per-function summary, for the
/// functions that have no HIR to read it off. `push` puts the reference in the
/// element slot and the array gives it back when it is dropped, so the caller
/// has nothing left to give up: the birth reference moves in.
///
/// It used to retain what it was given while the caller released its own a
/// moment later -- two operations to move a reference one slot, on every
/// element of every array of objects a program builds.
///
/// There is exactly one emitter, `lower_pushes`, and the runtime's own comment
/// states the convention, so the two cannot drift silently.
fn consumes(name: &str) -> Option<usize> {
    match name {
        "nts_array_push_ref" => Some(1),
        _ => None,
    }
}

/// Loads that take the slot's reference rather than copying it.
///
/// A load out of a slot that is overwritten before anything else can reach the
/// slot does not need to duplicate a count. The reference *moves* out of the
/// slot into the value, and the store that overwrites owes no release, because
/// by then the slot is holding nothing. Swift spells this `load [take]`, and it
/// is the third thing a load can be -- beside copying and borrowing, which are
/// the only two this pass could say before.
///
/// Borrowing cannot do this job. `swap` reads `pair.a` and has to keep it alive
/// *after* `pair.a` is overwritten, so there is no window in which the slot
/// still holds it and no borrow to be had. The 70 operations it took to move
/// two references between two slots were all of them this.
///
/// A slot is named by its container's *value* and its index. That is exact
/// rather than conservative -- one SSA value is one object, whatever its type
/// says, so the subclass hazard that makes `field_name` compare names does not
/// arise -- and two containers that are the same object under different values
/// simply fail to pair up, which costs precision and never correctness.
///
/// Returns the loads that take, and the stores that must give nothing back.
fn taking(
    func: &Func,
    layouts: &[Layout],
    crossing: &rustc_hash::FxHashSet<ValueId>,
    ops: &[ValueId],
) -> (
    rustc_hash::FxHashSet<ValueId>,
    rustc_hash::FxHashSet<ValueId>,
) {
    let mut held: rustc_hash::FxHashMap<(ValueId, u64), ValueId> =
        rustc_hash::FxHashMap::default();
    let mut takes = rustc_hash::FxHashSet::default();
    let mut settled = rustc_hash::FxHashSet::default();
    if !eliding() {
        return (takes, settled);
    }
    for &value in ops {
        // A borrow may not also take. `crossing` says nothing releases this
        // value and no edge retains for it; taking would make it owned, and
        // three rules disagreeing about one value is how a reference gets
        // consumed twice.
        let takeable = counted(func, layouts, value) && !crossing.contains(&value);
        match &func.values[value.0 as usize].kind {
            OpKind::FieldGet { object, field, .. } => {
                if takeable {
                    held.insert((*object, u64::from(*field)), value);
                }
            }
            OpKind::ArrayGet { array, index, .. } => match slot_of(func, *index) {
                Some(slot) if takeable => {
                    held.insert((*array, slot), value);
                }
                // An index this cannot name could be any of them.
                _ => held.clear(),
            },
            OpKind::FieldSet {
                object,
                field,
                value: stored,
                ..
            } => {
                let slot = (*object, u64::from(*field));
                if let Some(&taken) = held.get(&slot)
                    && taken != *stored
                {
                    takes.insert(taken);
                    settled.insert(value);
                }
                held.remove(&slot);
            }
            OpKind::ArraySet {
                array,
                index,
                value: stored,
                ..
            } => match slot_of(func, *index) {
                Some(index) => {
                    let slot = (*array, index);
                    if let Some(&taken) = held.get(&slot)
                        && taken != *stored
                    {
                        takes.insert(taken);
                        settled.insert(value);
                    }
                    held.remove(&slot);
                }
                None => held.clear(),
            },
            other => {
                if !quiet(other) {
                    held.clear();
                }
            }
        }
    }
    (takes, settled)
}

/// Callees that hand back one of their own parameters.
///
/// The `returns` column of record 0024's per-function summary. A parameter is
/// borrowed -- the caller holds it for the length of the call -- so a function
/// that returns one is handing back something the caller is already holding.
/// Today it retains before returning and the caller releases afterwards, which
/// is two operations to give somebody a reference they never let go of.
///
/// Restricted to inert functions, which is where the pattern lives: accessors,
/// pickers, and the small helpers a traversal is made of. An inert function
/// cannot store, call or allocate, so there is nothing it could do to the
/// argument between taking it and handing it back -- and it is the path whose
/// counting is decided in one place, `count_only_returns`, rather than woven
/// through the general one.
///
/// Every counted return must be a parameter. A function returning a parameter
/// on one path and something fresh on another hands back two different kinds of
/// thing, and the caller has one decision to make.
fn hands_back_a_parameter(
    program: &Program,
    layouts: &[Layout],
) -> rustc_hash::FxHashSet<String> {
    program
        .funcs
        .iter()
        .filter(|func| inert(func))
        .filter(|func| {
            let mut any = false;
            let every = func.blocks.iter().all(|block| {
                let super::Terminator::Return(Some(value)) = block.terminator else {
                    return true;
                };
                if !counted(func, layouts, value) {
                    return true;
                }
                any = true;
                matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
            });
            any && every
        })
        .map(|func| func.name.clone())
        .collect()
}

/// What an inert function still owes: a reference on whatever it hands back.
///
/// Its caller is owed an owned reference, and every value inside was borrowed.
fn count_only_returns(
    func: &mut Func,
    layouts: &[Layout],
    hands_back: &rustc_hash::FxHashSet<String>,
) -> Report {
    let mut report = Report::default();
    // Unless what it hands back is a parameter, which the caller is holding
    // already. See `hands_back_a_parameter`.
    if hands_back.contains(&func.name) {
        return report;
    }
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
    /// Which slots are still zero on entry to each block.
    entering: Vec<Fresh>,
    /// The parameters of each block, by block.
    receives: Vec<Vec<ValueId>>,
}

fn ambient(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    harmless: &rustc_hash::FxHashSet<String>,
) -> Ambient {
    let owned = entry_owned(func, layouts);
    let crossing = crossing_borrows(func, layouts, mutates, &owned);
    let mut live = liveness::analyze(func);
    // Held *after* liveness is computed and before anything reads it, so every
    // rule below sees one answer. An anchor that some rules think is dead and
    // others think is live is a reference consumed twice.
    for anchor in anchors(func, &crossing, &owned) {
        live.hold_to_every_exit(func, anchor);
    }
    Ambient {
        live,
        crossing,
        entering: freshness(func, harmless),
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
    harmless: &rustc_hash::FxHashSet<String>,
    hands_back: &rustc_hash::FxHashSet<String>,
) -> Report {
    let mut report = Report::default();
    let Ambient {
        live,
        crossing,
        entering,
        receives,
    } = ambient(func, layouts, mutates, harmless);
    let around = Surroundings {
        live: &live,
        mutates,
        harmless,
        hands_back,
        entering: &entering,
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
    let mut fresh = around
        .entering
        .get(at.0 as usize)
        .cloned()
        .unwrap_or_default();
    let mut moved = rustc_hash::FxHashSet::default();
    let mut borrowed = rustc_hash::FxHashSet::default();
    let (takes, settled) = taking(func, layouts, around.crossing, original);

    for (index, value) in original.iter().enumerate() {
        let kind = func.values[value.0 as usize].kind.clone();

        // A helper that takes ownership of an argument is a store with a
        // different spelling, and owes exactly what a store owes: move the
        // reference in if the value dies here, take one of its own if it does
        // not. See `consumes`.
        let consumed = match &kind {
            OpKind::Call {
                callee: super::Callee::External(name),
                args,
                ..
            } => consumes(name).and_then(|slot| args.get(slot).copied()),
            _ => None,
        };
        if let Some(given) = consumed
            && counted(func, layouts, given)
        {
            if owned(func, layouts, given)
                && !around.crossing.contains(&given)
                && around.live.dies_in(at, given)
                && moved.insert(given)
            {
                report.moves += 1;
            } else {
                retain(func, &mut ops, given, report);
            }
            fresh.observe(func, *value, &kind, around.harmless);
            ops.push(*value);
            continue;
        }

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
            // Nothing to give back when the slot's reference has already
            // been taken out of it by a load above, and nothing to give back
            // when the slot was still zero.
            let previous = if settled.contains(value) || fresh.initializing(func, &kind) {
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
                // A borrow has no reference to give away. `crossing` says
                // nothing releases this value and no edge retains for it, and
                // a store claiming the move is a third rule disagreeing with
                // both -- the slot ends up holding a reference nobody counted.
                //
                // That is not a hypothetical either. `aCellPerIteration`
                // stores its `sum` cell into a fresh closure once per
                // iteration; the store moved and the loop's back edge retained
                // to make up for it. The moment the edge stopped retaining --
                // because the value carrying the cell had become a borrow --
                // the closure and the frame both gave back one reference for
                // the one that was left, and the answer came out 4 where node
                // says 9.
                && !around.crossing.contains(stored)
                && around.live.dies_in(at, *stored)
                && moved.insert(*stored)
            {
                report.moves += 1;
            } else {
                retain(func, &mut ops, *stored, report);
            }
            fresh.observe(func, *value, &kind, around.harmless);
            ops.push(*value);
            if let Some(previous) = previous {
                release(func, &mut ops, previous, report);
            }
            continue;
        }
        fresh.observe(func, *value, &kind, around.harmless);

        ops.push(*value);

        // A producer that hands back a borrow is retained, so that every value
        // this function owns is owned the same way -- unless the borrow is
        // demonstrably good for as long as it is used, in which case the
        // function can just read the slot.
        if owned(func, layouts, *value) && !produces_owned(&kind) {
            if takes.contains(value) {
                // The reference moved out of the slot rather than being
                // copied, and the store that overwrites gives nothing back.
                report.moves += 1;
            } else if (is_load(&kind) || repackages(&kind))
                && (around.crossing.contains(value)
                    || borrows_safely(func, original, index, *value, at, terminator, around))
            {
                borrowed.insert(*value);
                report.borrows += 1;
            } else {
                retain(func, &mut ops, *value, report);
            }
        // A call that hands back one of its arguments hands back something this
        // function is already holding, so there is nothing to take and nothing
        // to give up. `borrows_safely` asks the same question of it as of a
        // load: does it die here, and can anything in between disturb it.
        //
        // The `else` is not optional, and leaving it out was a use-after-free.
        // The callee stops retaining *unconditionally* -- that is what being in
        // `hands_back` means -- so a caller that cannot prove the borrow safe
        // must take a reference of its own rather than fall through to
        // releasing one nobody ever gave it. `nullable` frees a string and then
        // reads it, and ASan is what said so while eighty nine programs went on
        // agreeing with node.
        } else if let OpKind::Call {
            callee: super::Callee::Direct(name),
            ..
        } = &kind
            && around.hands_back.contains(name)
            && owned(func, layouts, *value)
        {
            if borrows_safely(func, original, index, *value, at, terminator, around) {
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
/// Whether an operation renames a reference rather than producing one.
///
/// `Erase` packs a pointer beside a tag and `Unerase` reads it back out.
/// Neither allocates and neither copies, so the result is the operand under
/// another name -- which makes it borrowable on exactly the terms a load is:
/// what it names is kept alive by whoever was already keeping the operand
/// alive, and a store *of* it is still a transfer that owes a reference of its
/// own, which `borrows_safely` refuses for it as it does for a load.
///
/// Worth naming because it was not free. `erased-slot` puts a box into an
/// `unknown` and reads it straight back out, and paid four counting operations
/// per object for a round trip that moves no memory: a retain for the erased
/// name, a retain for the unerased one, and both given back.
fn repackages(kind: &OpKind) -> bool {
    matches!(kind, OpKind::Erase { .. } | OpKind::Unerase { .. })
}

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
/// It was one block at a time, and the comment here said the fix was "a forward
/// dataflow over the CFG with union at joins -- a slot is known-zero only where
/// it is zero on *every* path -- and the reason it is not here is that a wrong
/// answer does not fail loudly."
///
/// That reason has expired. `tooling/memory` fails on a leak in seconds and the
/// `execute` suite builds under `AddressSanitizer`, so being too eager here is
/// now exactly as loud as being wrong anywhere else. [`freshness`] is that dataflow.
///
/// What it was costing: a list built head-first stores through `tail`, which is
/// a block parameter, so every link's `next` was loaded and released on the way
/// past -- releasing the null the constructor had just written. Thirty two
/// operations of `traversal`'s ninety nine, and the same in four other cases.
///
/// A reference stops being fresh the moment it is handed to anything that could
/// store through it. Reading a field, reading an element and asking for a length
/// are not that; a call, a store, an edge and a return are.
#[derive(Debug, Default, Clone, PartialEq)]
struct Fresh {
    /// Objects and arrays whose slots this block still knows about.
    bases: rustc_hash::FxHashSet<ValueId>,
    /// Slots already written, so the second store to one is not initializing.
    written: rustc_hash::FxHashSet<(ValueId, u64)>,
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
fn freshness(func: &Func, harmless: &rustc_hash::FxHashSet<String>) -> Vec<Fresh> {
    /// Enough rounds for any reducible graph; reaching it would be a bug, and
    /// looping forever would hide it.
    const ROUNDS: usize = 1024;

    let count = func.blocks.len();
    let incoming = super::loops::predecessors(func);
    let mut entry: Vec<Option<Fresh>> = vec![None; count];
    if count > 0 {
        entry[0] = Some(Fresh::entering(func, BlockId(0)));
    }

    for _ in 0..ROUNDS {
        let mut changed = false;
        for at in 1..count {
            let mut merged: Option<Fresh> = None;
            for (from, args) in &incoming[at] {
                let Some(before) = entry[from.0 as usize].clone() else {
                    // Not reached yet: assume it agrees rather than let it
                    // decide, which is what keeps a loop enterable.
                    continue;
                };
                let mut after = before;
                for value in &func.blocks[from.0 as usize].ops {
                    let kind = func.values[value.0 as usize].kind.clone();
                    after.observe(func, *value, &kind, harmless);
                }
                let carried = after.across(&func.blocks[at].params, args);
                merged = Some(match merged {
                    None => carried,
                    Some(other) => other.both(&carried),
                });
            }
            let Some(merged) = merged else { continue };
            if entry[at].as_ref() != Some(&merged) {
                entry[at] = Some(merged);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    entry.into_iter().map(Option::unwrap_or_default).collect()
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

    /// The same facts, seen from the far side of an edge.
    ///
    /// A value the predecessor knew about is still that value in the successor
    /// -- SSA, so a name means one thing everywhere -- and on top of that, each
    /// argument hands its facts to the parameter that receives it.
    fn across(&self, params: &[ValueId], args: &[ValueId]) -> Self {
        let mut carried = self.clone();
        // A block parameter is re-bound on arrival, so nothing known about what
        // it held last time survives the edge. Around a back edge those facts
        // are stale by exactly one iteration, and the one that matters is
        // `written`: a list built head-first writes `tail.next` every time
        // round, and carrying that back made the *next* `tail` -- a different
        // link entirely -- look like a slot that had already been written.
        for param in params {
            carried.bases.remove(param);
            carried.escaped.remove(param);
            carried.written.retain(|(held, _)| held != param);
        }
        for (slot, param) in params.iter().enumerate() {
            let Some(arg) = args.get(slot) else { continue };
            if self.bases.contains(arg) {
                carried.bases.insert(*param);
            }
            if self.escaped.contains(arg) {
                carried.escaped.insert(*param);
            }
            for (held, field) in &self.written {
                if held == arg {
                    carried.written.insert((*param, *field));
                }
            }
        }
        carried
    }

    /// What two paths into one block agree about.
    ///
    /// Fresh where both are fresh, written where either is: `initializing` says
    /// yes only when the slot is a zero however the block was reached.
    fn both(&self, other: &Self) -> Self {
        Self {
            bases: self.bases.intersection(&other.bases).copied().collect(),
            written: self.written.union(&other.written).copied().collect(),
            // Reachable on either path is reachable.
            escaped: self.escaped.union(&other.escaped).copied().collect(),
        }
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
    fn observe(
        &mut self,
        func: &Func,
        value: ValueId,
        kind: &OpKind,
        harmless: &rustc_hash::FxHashSet<String>,
    ) {
        // A call that only initializes leaves its argument as fresh as it
        // arrived. See `initializing_only`.
        if let OpKind::Call {
            callee: super::Callee::Direct(name),
            ..
        } = kind
            && harmless.contains(name)
        {
            return;
        }
        match kind {
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } => {
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
                self.written.retain(|(held, _)| *held != value);
            }
            OpKind::FieldSet { object, field, .. } => {
                self.written.insert((*object, u64::from(*field)));
            }
            OpKind::ArraySet { array, index, .. } => {
                if let Some(slot) = slot_of(func, *index) {
                    self.written.insert((*array, slot));
                } else {
                    // An index this pass cannot name could be any of them, so
                    // the whole array stops being something it knows about.
                    self.bases.remove(array);
                    self.escaped.remove(array);
                }
            }
            // A load can hand back something that was stored, under a name this
            // cannot connect to the original -- and a store through *that* name
            // would be a write attributed to the wrong value. So the first load
            // gives up everything that has been stored anywhere.
            OpKind::FieldGet { .. } | OpKind::ArrayGet { .. } | OpKind::GlobalGet(_) => {
                for value in std::mem::take(&mut self.escaped) {
                    self.bases.remove(&value);
                }
            }
            _ => {}
        }
        // A call that is not `harmless` can do both: store through what it is
        // given, and read back what somebody else stored.
        if matches!(kind, OpKind::Call { .. }) {
            for value in std::mem::take(&mut self.escaped) {
                self.bases.remove(&value);
            }
        }
        for value in escaping_operands(kind) {
            // A store keeps the base and only marks it reachable. Everything
            // else that hands a reference somewhere gives it up outright.
            if matches!(
                kind,
                OpKind::FieldSet { .. } | OpKind::ArraySet { .. } | OpKind::GlobalSet { .. }
            ) {
                if self.bases.contains(&value) {
                    self.escaped.insert(value);
                }
            } else {
                self.bases.remove(&value);
                self.escaped.remove(&value);
            }
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
