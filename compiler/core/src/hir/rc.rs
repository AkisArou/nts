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
use super::own::{self, Ownership};
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

pub fn insert(program: &mut Program) -> Report {
    let mut report = Report::default();
    let layouts = program.layouts.clone();
    let summaries = own::summarize(program, &layouts);
    for func in &mut program.funcs {
        // Nothing an inert function does can invalidate a borrow, so nothing in
        // it needs a count -- except what leaves. See `own::inert`.
        let one = if own::inert(func) {
            count_only_returns(func, &layouts, &summaries)
        } else {
            insert_into(func, &layouts, &summaries)
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
        .filter(|value| own::owned(func, layouts, *value))
        .collect();
    counted_values.sort_unstable();
    counted_values
}

/// What an inert function still owes: a reference on whatever it hands back.
///
/// Its caller is owed an owned reference, and every value inside was borrowed.
fn count_only_returns(func: &mut Func, layouts: &[Layout], summaries: &own::Summaries) -> Report {
    let mut report = Report::default();
    // Unless what it hands back is a parameter, which the caller is holding
    // already. See `own::Summaries::hands_back`.
    if summaries.hands_back(&func.name) {
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
        .filter(|(_, value)| own::counted(func, layouts, *value))
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

// Over the line, and split further it would read worse. What follows is one
// decision made twice: what a block owes when it leaves the function, and what
// it owes on each edge. They share `moved`, `borrowed` and `crossing`, and
// separating them puts three sets through a signature to keep two halves of one
// rule apart.
#[allow(clippy::too_many_lines)]
fn insert_into(func: &mut Func, layouts: &[Layout], summaries: &own::Summaries) -> Report {
    let mut report = Report::default();
    // Read before the blocks are taken out below, because `own::analyze` needs
    // them and an edge still has to ask what its successor receives.
    let receives: Vec<Vec<ValueId>> = func
        .blocks
        .iter()
        .map(|block| block.params.clone())
        .collect();
    let mut live = liveness::analyze(func);
    let map = own::analyze(func, layouts, summaries, &mut live);
    let blocks = std::mem::take(&mut func.blocks);
    let mut rebuilt = Vec::with_capacity(blocks.len());
    // Blocks created to hold an edge's releases. Appended after the originals,
    // so the ids of those do not move.
    let mut split_blocks: Vec<super::Block> = Vec::new();
    let original_count = blocks.len();

    for (index, block) in blocks.into_iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        let Counted { mut ops, moved } = count_ops(
            func,
            layouts,
            at,
            &block.ops,
            &block.terminator,
            &Settled {
                map: &map,
                live: &live,
            },
            &mut report,
        );

        let edges = edges_of(&block.terminator);
        let mut terminator = block.terminator.clone();

        if edges.is_empty() {
            // Leaving the function. What is returned is handed to the caller and
            // everything else is dropped -- and a value that is both is moved.
            let mut dying = ordered(func, layouts, live.available(at));
            let here = map.null_in(at);
            dying.retain(|value| {
                !moved.contains(value)
                    && !map.borrowed(*value)
                    && !matches!(map.of(*value), Ownership::Unowned)
                    // Nothing to give back. See `own::Map::null_in`.
                    && !here.is_some_and(|proven| proven.contains(value))
            });
            let transfers: Vec<ValueId> = super::operands_of_terminator(&block.terminator)
                .into_iter()
                .filter(|value| own::counted(func, layouts, *value))
                .collect();
            for value in settle(&transfers, &mut dying) {
                retain(func, &mut ops, value, &mut report);
            }
            for value in dying {
                release_value(func, layouts, &map, &mut ops, value, &mut report);
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
                            && !map.borrowed(*value)
                            && !matches!(map.of(*value), Ownership::Unowned)
                            // Nothing to give back. See `nulls`.
                            //
                            // Indexed by the *successor*: this release is on
                            // the edge, and what the test proved is true on the
                            // far side of it. Asking about the block the branch
                            // is in gets nothing, because that is where the
                            // question was asked rather than answered.
                            && !map
                                .null_in(successor)
                                .is_some_and(|proven| proven.contains(value))
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
                        own::counted(func, layouts, *value)
                            && !landed.get(*slot).is_some_and(|param| map.borrowed(*param))
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
                        release_value(func, layouts, &map, &mut ops, value, &mut report);
                    }
                } else {
                    for value in retains {
                        retain(func, &mut edge_ops, value, &mut report);
                    }
                    for value in dying {
                        release_value(func, layouts, &map, &mut edge_ops, value, &mut report);
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
    settled: &Settled<'_>,
    report: &mut Report,
) -> Counted {
    let Settled { map, live } = settled;
    let mut ops = Vec::with_capacity(original.len());
    let mut moved = rustc_hash::FxHashSet::default();

    for (index, value) in original.iter().enumerate() {
        let kind = func.values[value.0 as usize].kind.clone();

        // A helper that takes ownership of an argument is a store with a
        // different spelling, and owes exactly what a store owes: move the
        // reference in if the value dies here, take one of its own if it does
        // not. See `consumes`.
        let handed_over = map.hands_over(*value).to_vec();
        if !handed_over.is_empty() {
            for given in handed_over {
                if !own::counted(func, layouts, given) {
                    continue;
                }
                // `dies_in` says the value's last read is somewhere in this
                // block, not that it is *here*. A store can lean on that,
                // because it claims the death and nothing after it reads what
                // was stored. A call cannot: `new Node(i)` hands `node` to a
                // constructor that keeps it, and the very next line reads
                // `node.next`.
                //
                // Handing over a reference that is read again afterwards leaves
                // the caller using something it no longer holds. In `cycles`
                // that made every self-cycle uncollectable rather than
                // dangling: the object's only reference became the one inside
                // itself, so no count ever fell, no candidate was ever buffered,
                // and a hundred objects a run leaked in silence.
                let read_again = original[index + 1..].iter().any(|later| {
                    super::verify::operands(&func.values[later.0 as usize].kind).contains(&given)
                }) || super::operands_of_terminator(terminator).contains(&given);
                if !read_again
                    && (own::owned(func, layouts, given) || map.owns(given))
                    && !map.borrowed(given)
                    && live.dies_in(at, given)
                    && moved.insert(given)
                {
                    report.moves += 1;
                } else {
                    retain(func, &mut ops, given, report);
                }
            }
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
        // Asked of the *slot*, not of the new value. `counted` says no to a
        // constant null -- rightly, since storing one takes no reference -- and
        // guarding the whole branch on it meant `x.f = null` skipped the load
        // and release of what `x.f` was holding. Every reference nulled out of
        // a field leaked, in every program, under naive counting too.
        //
        // `popDiskFrom` ends `top.next = null`, so `awfy-towers` leaked a disk
        // per move: 8191 of them, in the worst row in the benchmark table.
        if let OpKind::FieldSet { value: stored, .. }
        | OpKind::ArraySet { value: stored, .. }
        | OpKind::GlobalSet { value: stored, .. } = &kind
            && func.values[stored.0 as usize].ty.may_hold_a_reference()
        {
            // Nothing to give back when the slot's reference has already
            // been taken out of it by a load above, and nothing to give back
            // when the slot was still zero.
            let previous = if map.settles(*value) || map.initializes(*value) {
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
            if !own::counted(func, layouts, *stored) {
                // A null takes no reference of its own, and the slot has
                // already given up what it held.
            } else if matches!(
                func.values[stored.0 as usize].kind,
                OpKind::ObjectNew { frame: true }
            ) {
                // Neither: its fields are released where its frame ends.
            } else if (own::owned(func, layouts, *stored) || map.owns(*stored))
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
                && !map.borrowed(*stored)
                && live.dies_in(at, *stored)
                && moved.insert(*stored)
            {
                report.moves += 1;
            } else {
                retain(func, &mut ops, *stored, report);
            }
            ops.push(*value);
            if let Some(previous) = previous {
                release(func, &mut ops, previous, report);
            }
            continue;
        }
        ops.push(*value);

        // The whole decision, read rather than made. `own::analyze` has already
        // settled what every value in this function holds, and the four
        // predicates that used to be consulted here -- each at its own site,
        // each free to disagree with the others -- are one answer now.
        match map.of(*value) {
            // Takes a reference of its own, here.
            Ownership::Copied => retain(func, &mut ops, *value, report),
            // Took one out of a slot instead of copying it, and the store that
            // overwrote the slot gives nothing back.
            Ownership::Taken => report.moves += 1,
            // Holds none: something else keeps it alive for as long as it is
            // used, so nothing releases this either.
            Ownership::Borrowed => report.borrows += 1,
            // Already holds one, or has no count to change.
            Ownership::Produced | Ownership::Unowned => {}
        }
    }
    Counted { ops, moved }
}

/// What one block's counting reads from the rest of the function.
///
/// Two things, and only two: the ownership map, which says what every value
/// holds, and liveness, which says where a value's range ends. Everything else
/// this pass used to consult is inside the map.
struct Settled<'a> {
    map: &'a own::Map,
    live: &'a liveness::Liveness,
}

/// What counting one block produced.
struct Counted {
    ops: Vec<ValueId>,
    /// Values handed to a slot, which claimed their death.
    ///
    /// The one decision still made here rather than read off the map: at most
    /// one store per value may claim a death, and which store gets it depends
    /// on the order the block is walked in.
    moved: rustc_hash::FxHashSet<ValueId>,
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
    map: &own::Map,
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
    for field in own::reference_fields(func, layouts, value) {
        // A slot that only ever holds a null or another frame object has
        // nothing to give back, and loading it to release it is a load, a call
        // and a branch to decide nothing. See `own::Map::inert`.
        if map.inert(value, field) {
            continue;
        }
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
