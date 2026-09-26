//! Who owns what, and for how long.
//!
//! # One answer per value
//!
//! Every managed value in a function gets exactly one [`Ownership`], and every
//! decision about counting reads it. That is why this module exists, and it is
//! worth saying why, because the arrangement it replaced was not obviously
//! wrong.
//!
//! There were four predicates. `borrows_safely` asked of a load whether it
//! needed a retain; `crossing_borrows` asked of a value whether it was borrowed
//! everywhere it was live; `survives_the_function` asked of a container whether
//! it outlived the frame; and [`super::escape`] asked the same of an
//! allocation. Each was locally right. Each was consulted at a different site.
//!
//! Three of them are gone. What is left of the first two are private steps of
//! [`analyze`] -- `crossing_borrows` for the whole-function answer and
//! `borrows_safely` for the block-local one -- and nothing outside this module
//! can consult either. The third was two lines wrapping `anchored` and
//! `slot_survives`, and is inlined. The fourth, `escape`, is a separate pass
//! and is left alone rather than copied.
//!
//! `mutating` survives as one column of [`Summaries`] rather than as a
//! free-standing predicate. Record 0024 argues it should become per-slot, and
//! it should; what it does not yet have is a number to move. Every case in
//! `tooling/memory` is at its floor with the boolean, and the benchmark rows
//! that are still slow are slow from allocation.
//!
//! Three times that cost a use-after-free or a leak, and every one was two
//! halves of a single convention changed apart: a store that moved a borrow, an
//! edge that stopped retaining while a store went on moving, a callee that
//! stopped retaining while a caller went on releasing. A set of predicates
//! cannot be inconsistent with itself in only one place -- somebody has to ask
//! all of them the same question. Now it is asked once.
//!
//! # What decides it
//!
//! An *anchor* is a place alive for a reason nothing here can affect: a
//! parameter, because the caller holds it for the length of the call; a local
//! the frame owns, whose live range this stretches to every exit; or a slot of
//! something already anchored. A value borrowed from an anchor needs no count
//! of its own, and the whole of this module is working out which those are.
//!
//! Two fixpoints run in opposite directions, which is not an accident.
//! Borrowing is a *safety* property -- nothing on any path kills the anchor --
//! so it is a greatest fixpoint, assumed and then contradicted. Freshness is a
//! *must* property and is one too. The obligation to release accumulates and is
//! a least one. Borrowing and releasing shared a direction once, and the
//! traversal every real program is made of eliminated nothing.

use super::liveness;
use super::{BlockId, Func, HirType, Layout, ManagedType, OpKind, Program, ValueId};

/// What one value holds.
///
/// Exactly one of these per value. The counting pass does no reasoning of its
/// own: it reads this and emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ownership {
    /// No count to change: a constant, a frame object, anything immortal, or a
    /// value whose type cannot hold a reference at all.
    Unowned,
    /// Arrives already holding a reference -- an allocation, a call, a
    /// concatenation, or a block parameter the edge retained for.
    Produced,
    /// Must take a reference of its own, here.
    Copied,
    /// Holds one taken *out of* a slot, because the slot is overwritten before
    /// anything else can reach it. No retain here, and the store that
    /// overwrites gives nothing back.
    Taken,
    /// Holds none. Something else keeps it alive for as long as it is used.
    Borrowed,
}

/// What each function in the program does to what it is given.
///
/// The per-function summary record 0024 asks for. It named four columns; three
/// are here, and the fourth -- `escapes` -- already lives in [`super::escape`]
/// and is not written twice.
#[derive(Debug)]
pub struct Summaries {
    /// Functions that write through something, anywhere they can reach.
    mutates: rustc_hash::FxHashSet<String>,
    /// Dispatch slots some implementation of which does. See [`mutating_slots`].
    mutating_slots: rustc_hash::FxHashSet<u32>,
    /// Functions that leave an object exactly as fresh as it arrived.
    harmless: rustc_hash::FxHashSet<String>,
    /// Functions whose result is one of their own parameters.
    hands_back: rustc_hash::FxHashSet<String>,
    /// Parameter slots each function takes ownership of, by function name.
    consumes: rustc_hash::FxHashMap<String, rustc_hash::FxHashSet<u32>>,
    /// Parameter fields every caller has already zeroed, by function name. See
    /// [`zeroed_parameters`].
    zeroed: rustc_hash::FxHashMap<String, rustc_hash::FxHashSet<(u32, u32)>>,
    /// Globals holding a zero before anything runs, by index.
    ///
    /// Which is every reference-typed global: `Global::initial` is what it
    /// holds before the program starts, and a pointer's zero is a null. The
    /// module initializer is the one function that can use it -- see
    /// [`initializing_stores`] -- because it is the one function that runs
    /// before anything has had a chance to write one.
    starts_zero: rustc_hash::FxHashSet<u32>,
}

impl Summaries {
    /// Whether a function hands back one of its parameters, and so owes nothing
    /// on the way out: the caller is holding it already.
    #[must_use]
    pub fn hands_back(&self, name: &str) -> bool {
        self.hands_back.contains(name)
    }

    /// Which parameter slots a function takes ownership of. See [`consuming`].
    #[must_use]
    pub fn consumes(&self, name: &str) -> Option<&rustc_hash::FxHashSet<u32>> {
        self.consumes.get(name)
    }
}

/// Read every function once, before any of them is counted.
#[must_use]
pub fn summarize(program: &Program, layouts: &[Layout]) -> Summaries {
    let harmless = initializing_only(program, layouts);
    // **Every function some caller cannot see the target of.** Lifted out of
    // `consumes` below, where it was computed and explained, because a *second*
    // ownership fact needs the same set and the two must not derive it twice: a
    // function reached other than by a `Direct` call can neither take a parameter
    // over nor hand one back, for one reason -- the caller does not know which
    // body it is calling, so it cannot hold up its end of either convention.
    //
    // The comment inside `consumes` carries the argument and the case that forced
    // it (`Derived#keep(b, h) { h.box = b }` through a `Base`, which freed a live
    // `Box`). That case is the **parameter** half; `hands_back` is the **return**
    // half, and it was still wrong.
    let lent: rustc_hash::FxHashSet<&str> = program
        .foreign_classes
        .iter()
        .flat_map(super::ForeignClass::entered)
        .chain(
            program
                .layouts
                .iter()
                .flat_map(|layout| layout.methods.iter().flatten().map(String::as_str)),
        )
        .collect();
    // Computed before the literal because the slot answer is derived from it:
    // a slot mutates when an implementation in it does.
    // One fixpoint for both: a slot reaches a store when an implementation in
    // it does, and a function reaches one when it calls such a slot. Computing
    // them in sequence would settle the first against a stale second.
    let (mutates, mutating_slots) = mutating(program);
    Summaries {
        starts_zero: program
            .globals
            .iter()
            .enumerate()
            .filter(|(_, global)| global.initial == 0.0 && global.ty.may_hold_a_reference())
            .filter_map(|(at, _)| u32::try_from(at).ok())
            .collect(),
        zeroed: zeroed_parameters(program, layouts, &harmless),
        mutating_slots,
        mutates,
        harmless,
        // **Not a function a dispatch table holds.** `hands_back` means "the caller
        // is holding this already, so I owe nothing on the way out", and a caller
        // that reached the function through a slot cannot know that: it sees one
        // `Callee::Virtual` and several possible bodies, of which some may hand a
        // parameter back and others return something fresh.
        //
        // **Measured.** `class Leaf extends Base { self() { return this } }` called
        // through `Base` emitted `v2 = methods[0](v1);` with **no retain**, while
        // the same call on a `Leaf`-typed receiver emitted
        // `v2 = Leaf__self(v1); nts_retain(v2);`. So every store through a virtual
        // `return this` stole a reference, and under `--rc` the React lane's GTK
        // driver lost its root Box and Button to it -- `GTK_IS_BUTTON failed`, then
        // abort. A release reaching zero while the object is buffered waits for the
        // next collection, which is why it surfaced only at a checkpoint.
        //
        // Excluding it makes `count_only_returns` retain at the return instead, so
        // the convention is uniformly "owned" and **both** call sites are right
        // without either knowing which body ran. That is the same repair `consumes`
        // makes for the parameter direction, with the same set.
        hands_back: hands_back_a_parameter(program, layouts)
            .into_iter()
            .filter(|name| !lent.contains(name.as_str()))
            .collect(),
        consumes: {
            // A function takes over a parameter it stores only if every way
            // into it hands one over, and only a `Direct` call does
            // (`handing_over`). Two other ways in lend their arguments:
            //
            // - A foreign runtime -- an Objective-C method, a `GObject`
            //   virtual function, a COM override -- calls through an entry the
            //   backend emits, passing each argument borrowed, `self` at +0
            //   as ARC passes it (`ForeignClass::entered`).
            // - A dispatch: a method some table holds, reached by a
            //   `Callee::Virtual` whose target the caller cannot see, and a
            //   closure's body, reached through its table by a
            //   `Callee::Closure` or by a bridge C calls. A closure's body is
            //   in its layout's table like any method, which is why closures
            //   need no line of their own here.
            //
            // **The soundness of the second set is a fact about
            // `Layout::methods`**, not visible from its name: it lists the
            // slots something fills, and is empty where nothing overrides, so
            // a method no subclass overrides keeps the handover. A table
            // filled eagerly -- every class's methods, overridden or not --
            // would strip the handover everywhere, and nothing would go red,
            // since the cost is a retain rather than a free.
            //
            // Excluding a function adds a retain at its store, so a function
            // left out needlessly costs a count; one wrongly kept frees what
            // its store still points at. `Derived#keep(b, h) { h.box = b }`
            // through a `Base` did: the `Box` was freed and reused.
            program
                .funcs
                .iter()
                .filter(|func| !lent.contains(func.name.as_str()))
                .filter_map(|func| {
                    let slots = consuming(func, layouts);
                    (!slots.is_empty()).then(|| (func.name.clone(), slots))
                })
                .collect()
        },
    }
}

/// One function's answer, for every value in it.
#[derive(Debug)]
pub struct Map {
    of: Vec<Ownership>,
    settled: rustc_hash::FxHashSet<ValueId>,
    initializing: rustc_hash::FxHashSet<ValueId>,
    nulls: Vec<rustc_hash::FxHashSet<ValueId>>,
    inert: rustc_hash::FxHashSet<(ValueId, u32)>,
    /// Slots that are still a zero where each block ends. See
    /// [`initializing_stores`].
    still_zero: Vec<rustc_hash::FxHashSet<(ValueId, u32)>>,
    /// Parameters of *this* function that arrive owned, because every caller
    /// hands the reference over. See [`consuming`].
    owns: rustc_hash::FxHashSet<ValueId>,
    /// What each call takes ownership of, by the call's own value.
    hands_over: rustc_hash::FxHashMap<ValueId, Vec<ValueId>>,
}

impl Map {
    /// What this value holds.
    #[must_use]
    pub fn of(&self, value: ValueId) -> Ownership {
        self.of
            .get(value.0 as usize)
            .copied()
            .unwrap_or(Ownership::Unowned)
    }

    /// Whether this value needs no count of its own.
    #[must_use]
    pub fn borrowed(&self, value: ValueId) -> bool {
        self.of(value) == Ownership::Borrowed
    }

    /// Whether a store gives nothing back, because a [`Ownership::Taken`] load
    /// above it has already taken what the slot was holding.
    #[must_use]
    pub fn settles(&self, store: ValueId) -> bool {
        self.settled.contains(&store)
    }

    /// Whether a store writes over a zero, and so owes no load and no release
    /// -- and, because it adds an edge and removes none, cannot end anybody's
    /// borrow either.
    #[must_use]
    pub fn initializes(&self, store: ValueId) -> bool {
        self.initializing.contains(&store)
    }

    /// Whether a parameter of this function arrives owned, so storing it hands
    /// the reference on rather than needing one of its own.
    #[must_use]
    pub fn owns(&self, value: ValueId) -> bool {
        self.owns.contains(&value)
    }

    /// What a call takes ownership of: arguments the callee keeps, which the
    /// caller therefore moves or retains exactly as a store does.
    #[must_use]
    pub fn hands_over(&self, call: ValueId) -> &[ValueId] {
        self.hands_over.get(&call).map_or(&[], Vec::as_slice)
    }

    /// Whether a slot holds a zero where this block ends, so the walk over a
    /// frame object's fields can skip it there. A field cleared on the way out
    /// is the common shape: a cursor, a free list, a `next` set back to null.
    #[must_use]
    pub fn still_zero(&self, block: BlockId, object: ValueId, field: u32) -> bool {
        self.still_zero
            .get(block.0 as usize)
            .is_some_and(|zero| zero.contains(&(object, field)))
    }

    /// Whether a slot never holds anything that has to be given back, so the
    /// walk over a frame object's fields can skip it. See [`inert_slots`].
    #[must_use]
    pub fn inert(&self, object: ValueId, field: u32) -> bool {
        self.inert.contains(&(object, field))
    }

    /// Values proven null on entry to a block, where releasing is a call and a
    /// branch to decide nothing.
    #[must_use]
    pub fn null_in(&self, block: BlockId) -> Option<&rustc_hash::FxHashSet<ValueId>> {
        self.nulls.get(block.0 as usize)
    }
}

/// What each call in a function takes ownership of, by the call's own value.
///
/// A runtime helper says so in [`consumes`]; a function with a body says so by
/// storing the parameter on every path out, which is [`consuming`]. Either way
/// the caller owes the callee a reference, and hands over the one it is holding
/// where it can.
fn handing_over(
    func: &Func,
    summaries: &Summaries,
) -> rustc_hash::FxHashMap<ValueId, Vec<ValueId>> {
    let mut over: rustc_hash::FxHashMap<ValueId, Vec<ValueId>> = rustc_hash::FxHashMap::default();
    for block in &func.blocks {
        for value in &block.ops {
            let OpKind::Call { callee, args, .. } = &func.values[value.0 as usize].kind else {
                continue;
            };
            let taken: Vec<ValueId> = match callee {
                super::Callee::External(name) => consumes(name)
                    .and_then(|slot| args.get(slot).copied())
                    .into_iter()
                    .collect(),
                super::Callee::Direct(name) => summaries
                    .consumes(name)
                    .map(|slots| {
                        let mut slots: Vec<u32> = slots.iter().copied().collect();
                        slots.sort_unstable();
                        slots
                            .into_iter()
                            .filter_map(|slot| args.get(slot as usize).copied())
                            .collect()
                    })
                    .unwrap_or_default(),
                // A foreign function says which of its parameters it takes over
                // (`init` consumes its receiver), and only for counted handles
                // does the count here have anything to hand.
                super::Callee::Native(target) => target
                    .consumes
                    .iter()
                    .filter_map(|slot| args.get(*slot).copied())
                    .filter(|arg| func.values[arg.0 as usize].ty.counting().is_some())
                    .collect(),
                // Which body a dispatch reaches is decided by a receiver this
                // cannot see, and they need not agree about what they keep.
                super::Callee::Virtual { .. } | super::Callee::Closure { .. } => Vec::new(),
            };
            if !taken.is_empty() {
                over.insert(*value, taken);
            }
        }
    }
    over
}

/// What `analyze` has settled before it says what each value holds.
struct Decided<'a> {
    /// Borrowed for their whole life. See [`crossing_borrows`].
    crossing: &'a rustc_hash::FxHashSet<ValueId>,
    /// Slots holding nothing that needs a count. See [`inert_slots`].
    inert: &'a rustc_hash::FxHashSet<(ValueId, u32)>,
    /// Loads that take the slot's reference. See [`taking`].
    takes: &'a rustc_hash::FxHashSet<ValueId>,
}

/// One [`Ownership`] per value, from what has already been settled.
fn classify(
    func: &Func,
    layouts: &[Layout],
    summaries: &Summaries,
    live: &liveness::Liveness,
    decided: &Decided<'_>,
    of: &mut [Ownership],
) {
    // What anything reads, for the one rule below that asks.
    let read: rustc_hash::FxHashSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| {
            block
                .ops
                .iter()
                .flat_map(|value| super::operands_of(&func.values[value.0 as usize].kind))
                .chain(super::operands_of_terminator(&block.terminator))
        })
        .collect();
    for (at, block) in func.blocks.iter().enumerate() {
        let here = BlockId(u32::try_from(at).unwrap_or(u32::MAX));
        let around = Surroundings {
            live,
            mutates: &summaries.mutates,
            mutating_slots: &summaries.mutating_slots,
        };
        for param in &block.params {
            if owned(func, layouts, *param) {
                of[param.0 as usize] = if decided.crossing.contains(param) {
                    Ownership::Borrowed
                } else {
                    Ownership::Produced
                };
            }
        }
        for (index, value) in block.ops.iter().enumerate() {
            // A *read* of a slot that only ever holds frame objects is one of
            // them, and there is nothing to give back. Only a read: a frame
            // object holding references still needs the walk that gives them
            // up, which is what `owned` is asking when it checks whether it has
            // any. Skipping that leaked the whole of `store-elsewhere`'s list.
            let read_from_inert = matches!(
                &func.values[value.0 as usize].kind,
                OpKind::FieldGet { object, field, .. } if decided.inert.contains(&(*object, *field))
            );
            if !owned(func, layouts, *value) || read_from_inert {
                continue;
            }
            let kind = &func.values[value.0 as usize].kind;
            let safely = || {
                borrows_safely(
                    func,
                    &block.ops,
                    index,
                    *value,
                    here,
                    &block.terminator,
                    &around,
                )
            };
            of[value.0 as usize] = if decided.takes.contains(value) {
                Ownership::Taken
            } else if let OpKind::Call {
                callee: super::Callee::Direct(name) | super::Callee::External(name),
                ..
            } = kind
            {
                // A call that hands back one of its arguments hands back
                // something this function is already holding, so there is
                // nothing to take and nothing to give up -- when the borrow can
                // be proved safe.
                //
                // `External` as well as `Direct`, because the runtime is where
                // most of these are: `set` and `add` and `fill` and `reverse`
                // return their receiver, and no pass reads their bodies. They
                // are named in `RUNTIME_HANDS_BACK` instead.
                //
                // When it cannot, the caller takes one of its own. `Produced`
                // would be wrong and is a use-after-free: the callee stops
                // retaining *unconditionally*, so there is no reference here to
                // have been produced.
                if !summaries.hands_back.contains(name) {
                    Ownership::Produced
                } else if safely() {
                    Ownership::Borrowed
                } else {
                    Ownership::Copied
                }
            } else if let OpKind::Call { callee: super::Callee::Native(target), .. } = kind
                && func.values[value.0 as usize].ty.counting().is_some()
            {
                // A counted handle a foreign function returns is +1 only when
                // the declaration says so (ARC's `alloc`/`new`/`copy`/
                // `mutableCopy`/`init`). Otherwise it is borrowed from the
                // callee, which for Objective-C means from the autorelease
                // pool, and keeping it takes a reference of our own.
                //
                // **A borrowed result nobody reads is not touched**, as ARC
                // does not touch one: the pool that holds it gives it back.
                // Retaining it anyway is a retain and a release for nothing
                // on every call that ignores its result, and worse when the
                // result is not an object at all: `performSelector:withObject:`
                // on a `void` method answers whatever the return register
                // held, and `objc_retain` of that ended the process.
                if target.returns_owned {
                    Ownership::Produced
                } else if read.contains(value) {
                    Ownership::Copied
                } else {
                    Ownership::Borrowed
                }
            } else if views_borrow(func, *value, decided.crossing) {
                Ownership::Borrowed
            } else if produces_owned(kind) {
                Ownership::Produced
            } else if (is_load(kind) || repackages(kind))
                && (decided.crossing.contains(value) || safely())
            {
                Ownership::Borrowed
            } else {
                Ownership::Copied
            };
        }
    }
}

/// Work out who owns what.
///
/// Takes liveness by `&mut` because it changes it: an anchor has to outlive
/// whatever borrows from it, and stretching its live range here -- rather than
/// where releases are placed -- is what keeps every rule that reads liveness
/// agreeing about it. Two rules disagreeing about one value is how a reference
/// gets consumed twice, and this file exists because that happened three times.
#[must_use]
pub fn analyze(
    func: &Func,
    layouts: &[Layout],
    summaries: &Summaries,
    live: &mut liveness::Liveness,
) -> Map {
    // What its callers were told it takes over (`Summaries::consumes`), so
    // the callee and every caller answer from one derivation.
    let owns: rustc_hash::FxHashSet<ValueId> = summaries
        .consumes
        .get(&func.name)
        .into_iter()
        .flatten()
        .map(|slot| ValueId(*slot))
        .collect();
    let held = entry_owned(func, layouts);
    let vouched = summaries
        .zeroed
        .get(&func.name)
        .cloned()
        .unwrap_or_default();
    let entering = freshness(func, layouts, &summaries.harmless, &vouched);
    let (initializing, still_zero) = initializing_stores(
        func,
        layouts,
        &entering,
        &summaries.harmless,
        &summaries.starts_zero,
    );
    let crossing = crossing_borrows(
        func,
        layouts,
        &summaries.mutates,
        &held,
        &initializing,
        &summaries.harmless,
        &owns,
    );
    for anchor in anchors(func, &crossing, &held) {
        live.hold_to_every_exit(func, anchor);
    }
    // And a foreign counted handle a name still holds, which is an anchor for a
    // reason *no* analysis here can see. See `held_to_the_end`.
    for handle in held_to_the_end(func) {
        live.hold_to_every_exit(func, handle);
    }

    let live = &*live;
    let hands_over = handing_over(func, summaries);
    let inert = inert_slots(func, layouts, &summaries.harmless);
    let absent = nulls(func);
    let (takes, settled) = taking(func, layouts, &crossing, &summaries.harmless);
    let mut of = vec![Ownership::Unowned; func.values.len()];

    classify(
        func,
        layouts,
        summaries,
        live,
        &Decided {
            crossing: &crossing,
            inert: &inert,
            takes: &takes,
        },
        &mut of,
    );

    Map {
        of,
        settled,
        initializing,
        nulls: absent,
        inert: inert.clone(),
        still_zero,
        owns,
        hands_over,
    }
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
/// Whether a slot is one the language promises is never written again.
///
/// `Field::readonly` is semantic, not syntactic: `Readonly<T>` counts, and so
/// does a field the checker proved is only assigned in the constructor. It has
/// been computed since layouts existed and nothing has ever read it.
fn field_is_settled(func: &Func, layouts: &[Layout], object: ValueId, field: u32) -> bool {
    let HirType::Managed(ManagedType::Object(id)) = &func.values[object.0 as usize].ty else {
        return false;
    };
    layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .and_then(|layout| layout.fields.get(field as usize))
        .is_some_and(|field| field.readonly)
}

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
    /// Stores that write over a zero, and so disconnect nothing. See
    /// [`initializing_stores`].
    initializing: &'a rustc_hash::FxHashSet<ValueId>,
    /// Callees that only initialize, and so disturb no slot anyone is watching.
    harmless: &'a rustc_hash::FxHashSet<String>,
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

/// A foreign counted handle whose release belongs at the function's end rather
/// than at its last *read*.
///
/// **The dependency this exists for is not in the IR and cannot be.** A
/// `GtkTextIter` points into its buffer's btree without taking a reference --
/// GTK's documented contract is that the caller keeps the buffer alive -- so
/// `buffer.get_bounds(start, end)` makes `start` and `end` depend on `buffer`
/// with nothing in the HIR saying so. Under `--rc` the buffer's last read was
/// `get_text`, its release landed on the edge after it, GTK freed the buffer, and
/// reading the iterators printed a critical under `G_DEBUG=fatal-warnings`. GJS
/// keeps the buffer while the name is reachable, and so does every other binding
/// language; this is the closest a compiler can come without an edge to follow.
///
/// So it is an **anchor** in this file's sense -- *"a place alive for a reason
/// nothing here can affect"* -- and it takes the same stretch, in the same place,
/// for the reason the header of [`analyze`] gives: a rule that reads liveness and
/// a rule that changes it must not be two passes apart.
///
/// `rc::release_at_last_use` already said this in words -- *"A foreign object
/// keeps the block's end. The platform may hold it without a count and nothing
/// here can see that"* -- and it was not true, because the **edge** path releases
/// what a successor does not read and has no such filter. Stretching the range
/// fixes both without either path knowing: a value live to every exit is not dying
/// on any edge.
///
/// # Four conditions, each one a measurement
///
/// **Counted**: an uncounted handle has no release to place.
///
/// **Nothing else may be holding it.** A handle stored into a field or an array,
/// or handed to a *runtime* helper that may keep it ([`super::runtime::keeps`]),
/// belongs to that container, which gives it up when it is overwritten or freed
/// -- so stretching the temporary would make an object outlive the only thing
/// holding it. `examples/interop/macos-classes`
/// asserts that through a weak watch: `objects[0] = new NSObject()` replaces the
/// one `watched()` made, and it must read `gone`. A **native** call is not a
/// holder -- C borrows its arguments for the call, and that unrecorded borrow is
/// the entire reason this rule exists -- which is the line `Callee::Native` draws.
///
/// **An `Erase` is a holder too**, which this rule denied for one commit. A handle
/// reaches a table, an `unknown` or a field through `erase(handle)` with the erased
/// value as the argument, so the handle itself is only the `Erase` operand -- and
/// holding it to the return keeps an object alive past the entry that owned it. It
/// was left out at first because no fixture witnessed it and a guard nothing
/// reaches reads as protection; the GTK lane produced the witness the same evening
/// (`gtk-values`' `temporary` arm, a button set into a map, watched, then deleted,
/// which must read `gone`), and `examples/interop/macos-classes` will produce the
/// Objective-C one as soon as such a handle stops being boxed on its way in.
///
/// **Defined outside every cycle.** A handle made in a loop keeps today's
/// placement: one `ValueId` stands for every iteration's handle, so holding it to
/// the exit would release the last and leak the rest. What it wants is the end of
/// its *iteration*, which is a different change with a different fixture;
/// `examples/interop/gtk-iter-lifetime/escape` records that the
/// invisible-dependency problem is not fully closed.
///
/// **Its definition dominates every exit.** [`liveness::Liveness::
/// hold_to_every_exit`] makes a value available in *every* block, so a release
/// lands in each terminal one -- and in a **resumed** function, whose entry
/// dispatches to one state per suspension, a value defined in one state's block is
/// not available at an exit reached from another. Without this guard `verify`
/// answered `NotDominated { func: "use__resume", … }` eighteen times for one test.
/// The same guard `super::undominated_names` applies to a frame object's names,
/// through the same dominator walk.
fn held_to_the_end(func: &Func) -> Vec<ValueId> {
    let exits: Vec<BlockId> = func
        .blocks
        .iter()
        .enumerate()
        .filter(|(_, block)| block.terminator.successors().is_empty())
        .map(|(at, _)| BlockId(u32::try_from(at).unwrap_or(0)))
        .collect();
    if exits.is_empty() {
        return Vec::new();
    }
    let held_by_something: rustc_hash::FxHashSet<ValueId> = func
        .values
        .iter()
        .flat_map(|op| match &op.kind {
            OpKind::FieldSet { value, .. } | OpKind::ArraySet { value, .. } => vec![*value],
            // **An erased handle is held by the slot it is erased into.** A
            // handle reaches a table, an `unknown` or a field through
            // `erase(handle)` and the erased value as the argument, so the
            // handle itself is only this operand -- and holding it to the
            // return would keep an object alive past the entry that owned it.
            // The GTK lane's `gtk-values` `temporary` arm is the witness:
            // `m.set("t", new GtkButton())`, watched, then deleted, must read
            // `gone`. It is also the half that makes their
            // `release_at_last_use` exemption reachable -- an erased
            // temporary's release belongs at its last use, which is ARC's
            // end-of-statement, and this rule must not hold it past that.
            //
            // **Back through the `Convert` views, because the owner is not the
            // operand.** `new GtkButton()` is `gtk_button_new() : GtkWidget*`
            // then `convert : GtkButton*` then `erase`, so the value that owns
            // the reference is two steps behind the `Erase`. Marking only the
            // operand leaves the owner unheld and holds it to the return, which
            // is the GTK lane's `temporary` arm reading `alive`. `liveness`
            // walks the same chain for the same reason -- see its `viewed` map,
            // *"a counted handle converted to a type nothing counts is read
            // through the conversion afterwards, which holds no reference"*.
            OpKind::Erase { value, .. } => {
                let mut chain = vec![*value];
                let mut at = *value;
                while let OpKind::Convert(inner) = func.values[at.0 as usize].kind {
                    chain.push(inner);
                    at = inner;
                }
                chain
            }
            OpKind::Call { callee, args, .. } => match callee {
                // A native call *borrows* its arguments for the call, and that
                // unrecorded borrow is the whole reason this rule exists -- except
                // for the parameters whose reference it takes over. `alloc()` then
                // `init(o)` is Objective-C's two-step, and `init` consumes its
                // receiver: holding the `alloc` result to the end leaves a second
                // reference to the *same object* alive, so
                // `examples/interop/macos-classes`' map entry read `alive` where it
                // must read `gone`. See `native::Function::consumes`.
                super::Callee::Native(function) => function
                    .consumes
                    .iter()
                    .filter_map(|at| args.get(*at).copied())
                    .collect(),
                // A runtime helper holds what `runtime::keeps` says it may
                // keep past the call -- every argument, where it says
                // nothing, which fails late rather than early. One it only
                // reads is no holder: `nts_com_query(button, iid)` answers a
                // reference of its own and keeps none of the button's, and
                // taking it for a holder released every COM object a function
                // asked for another interface at that read. winui-hello's
                // `rebuilt` arm is the witness: the button went before its
                // automation peer, which holds it weakly, could press it.
                super::Callee::External(name) => match super::runtime::keeps(name) {
                    Some(kept) => kept.iter().filter_map(|at| args.get(*at).copied()).collect(),
                    None => args.clone(),
                },
                _ => args.clone(),
            },
            _ => Vec::new(),
        })
        .collect();
    let mut defined_in: Vec<Option<BlockId>> = vec![None; func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        for value in block.ops.iter().chain(&block.params) {
            if let Some(slot) = defined_in.get_mut(value.0 as usize) {
                *slot = Some(at);
            }
        }
    }
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let dominates = |over: BlockId, under: BlockId| {
        let mut at = Some(under);
        while let Some(block) = at {
            if block == over {
                return true;
            }
            at = idom[block.0 as usize];
        }
        false
    };
    let mut found = Vec::new();
    for (at, op) in func.values.iter().enumerate() {
        if op.ty.counting().is_none() {
            continue;
        }
        let value = ValueId(u32::try_from(at).unwrap_or(u32::MAX));
        if held_by_something.contains(&value) {
            continue;
        }
        let Some(Some(block)) = defined_in.get(value.0 as usize).copied() else {
            continue;
        };
        if super::loops::in_a_cycle(func, block) {
            continue;
        }
        if exits.iter().all(|exit| dominates(block, *exit)) {
            found.push(value);
        }
    }
    found
}

/// Whether a container is alive for a reason nothing here can affect.
///
/// A parameter is, because the caller holds it. One that is itself a settled
/// borrow is, one step up, and the chain ends at a parameter -- so `bodies[i]`
/// qualifies once `bodies` does, which is the shape `NBodySystem#advance` is
/// made of. An owned local is, because this pass stretches its live range to
/// every exit; see [`entry_owned`].
fn anchored(func: &Func, standing: &Standing<'_>, container: ValueId) -> bool {
    matches!(func.values[container.0 as usize].kind, OpKind::Param(_))
        || standing.settled.contains(&container)
        || standing.owned.contains(&container)
}

/// Values an initializing store has put inside something anchored.
///
/// After `c.f = v` where `c` is anchored and the slot was zero, `v` is reachable
/// from whatever anchors `c`, and is alive for exactly as long. An initializing
/// store adds an edge and removes none, so the only thing that could take `v`
/// away again is a store over a slot that was *not* zero -- which is what
/// [`slot_survives`] goes on to rule out.
///
/// This is what lets the link a list has just been extended with travel on as a
/// borrow. `made` is stored into `tail.next` before it is carried round the
/// loop, so by the time the edge takes it the list already holds it, and the
/// retain that edge was doing was for a reference the list had.
fn housed_safely(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    standing: &Standing<'_>,
    unobserved: &rustc_hash::FxHashSet<ValueId>,
    value: ValueId,
) -> bool {
    func.values.iter().enumerate().any(|(index, op)| {
        let store = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
        if !standing.initializing.contains(&store) {
            return false;
        }
        let (container, field) = match &op.kind {
            OpKind::FieldSet {
                object,
                field,
                value: stored,
                ..
            } if *stored == value => (*object, Some(*field)),
            OpKind::ArraySet {
                array,
                value: stored,
                ..
            } if *stored == value => (*array, None),
            _ => return false,
        };
        anchored(func, standing, container)
            && slot_survives(
                func, layouts, mutates, standing, unobserved, container, field, store,
            )
    })
}


/// Whether a slot goes on holding what it holds, everywhere this can reach.
#[allow(clippy::too_many_arguments)]
fn slot_survives(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    standing: &Standing<'_>,
    unobserved: &rustc_hash::FxHashSet<ValueId>,
    container: ValueId,
    from_field: Option<u32>,
    from: ValueId,
) -> bool {
    let ours = from_field.and_then(|field| field_name(func, layouts, container, field));
    // A borrow out of a `readonly` slot cannot be ended by a call. No callee can
    // write the slot -- that is what the word means -- so the reference the load
    // found is still held by a container this borrow already required to be
    // alive, and one call cannot take it away. Without this, any call that
    // stores *anything* ends the borrow, which is how a field the checker
    // proved constant came to be counted once per read.
    let settled = from_field.is_some_and(|field| field_is_settled(func, layouts, container, field));
    // Only what can run after the load. A borrow is invalidated by a store or a
    // call that happens *later*, and scanning the whole function charged it for
    // everything that happened earlier too -- which is most of a function that
    // builds a structure and then walks it. `local-anchor` builds a list with a
    // call that stores and then walks it with no call at all, and paid for the
    // build on every step of the walk.
    let after = standing
        .defined_in
        .get(from.0 as usize)
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
            let mine = standing.defined_in[from.0 as usize].unwrap_or(theirs);
            if theirs != mine && !reachable.contains(&theirs) {
                return false;
            }
        }
        // A store that writes over a zero adds an edge and removes none, so
        // nothing it does can end a borrow. Without this a list cannot be built
        // without counting: the store that extends the chain looks exactly like
        // one that could cut it, because both write a field called `next`.
        if standing.initializing.contains(&each) {
            return false;
        }
        match &op.kind {
        OpKind::Call {
            callee: super::Callee::Direct(name),
            ..
        } => !settled && mutates.contains(name) && !standing.harmless.contains(name),
        OpKind::Call { .. } => !settled,
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

/// Values that are null on entry to each block.
///
/// A block reached only by the arm of an `x === null` test that says *yes*
/// holds a null in `x`, and releasing a null is a call and a branch to decide
/// nothing. `counted` already refuses a null that is spelled as a constant;
/// this is the one that arrives as the result of a call and is then tested,
/// which is what every `T | null` return looks like at the point it is checked.
///
/// Managed references only. For an erased value the null is a *tag*, and
/// whether the payload beside it is a reference is a different question.
///
/// Agreement across every incoming edge, because a block reached one way with a
/// proven null and another way without one has no proof at all.
fn nulls(func: &Func) -> Vec<rustc_hash::FxHashSet<ValueId>> {
    let incoming = super::loops::predecessors(func);
    (0..func.blocks.len())
        .map(|at| {
            let arriving = &incoming[at];
            let mut agreed: Option<rustc_hash::FxHashSet<ValueId>> = None;
            for (from, _) in arriving {
                let here = proves_null(func, *from, at);
                agreed = Some(match agreed {
                    None => here,
                    Some(before) => before.intersection(&here).copied().collect(),
                });
            }
            agreed.unwrap_or_default()
        })
        .collect()
}

/// What one edge's branch proves about a value being absent.
///
/// A block reached only by the arm of an `x === null` that says yes holds a null
/// in `x`. Managed references only: for an erased value the null is a *tag*, and
/// whether the payload beside it is a reference is a different question.
fn proves_null(func: &Func, from: BlockId, to: usize) -> rustc_hash::FxHashSet<ValueId> {
    let mut here = rustc_hash::FxHashSet::default();
    let super::Terminator::Branch {
        cond,
        then_target,
        else_target,
        ..
    } = &func.blocks[from.0 as usize].terminator
    else {
        return here;
    };
    let OpKind::Binary { op, lhs, rhs } = &func.values[cond.0 as usize].kind else {
        return here;
    };
    let against_null = |one: ValueId, other: ValueId| {
        (matches!(func.values[other.0 as usize].kind, OpKind::ConstNull)
            && matches!(func.values[one.0 as usize].ty, HirType::Managed(_)))
        .then_some(one)
    };
    if let Some(subject) = against_null(*lhs, *rhs).or_else(|| against_null(*rhs, *lhs)) {
        let yes = then_target.0 as usize == to && else_target.0 as usize != to;
        let no = else_target.0 as usize == to && then_target.0 as usize != to;
        if (matches!(op, super::BinOp::Eq) && yes) || (matches!(op, super::BinOp::Ne) && no) {
            here.insert(subject);
        }
    }
    here
}

/// Values absent on entry to each block, carried forward.
///
/// `proves_null` answers it for one edge; a value it proved absent stays absent
/// through the block it lands in and out the other side, because SSA gives one
/// value one meaning. That is what lets a take survive a *join*: the arm that
/// tested the value and found nothing still says so two blocks later.
fn absent_on_entry(func: &Func) -> Vec<rustc_hash::FxHashSet<ValueId>> {
    let incoming = super::loops::predecessors(func);
    let mut known: Vec<rustc_hash::FxHashSet<ValueId>> =
        vec![rustc_hash::FxHashSet::default(); func.blocks.len()];
    // Index order, and a predecessor that has not been reached yet contributes
    // nothing -- which is the safe direction for a *must* fact and stops a back
    // edge from claiming anything.
    for at in 0..func.blocks.len() {
        let mut agreed: Option<rustc_hash::FxHashSet<ValueId>> = None;
        for (from, _) in &incoming[at] {
            let mut here = proves_null(func, *from, at);
            if (from.0 as usize) < at {
                here.extend(known[from.0 as usize].iter().copied());
            }
            agreed = Some(match agreed {
                None => here,
                Some(before) => before.intersection(&here).copied().collect(),
            });
        }
        known[at] = agreed.unwrap_or_default();
    }
    known
}

/// Whether every store in this function can be attributed to one object.
///
/// A store is aimed by naming something. If every `FieldSet` names an
/// allocation or a parameter directly, it hits exactly the object it names --
/// two allocations are two objects, and a parameter was bound before either
/// existed -- so the writes a pass records are all the writes there are.
///
/// A store through anything else could be aimed at a slot under another name,
/// and `loop-break` is why this is a *function-wide* question rather than a
/// per-store one: it writes `tail.next` where `tail` is a block parameter
/// carrying the head, so recording the write against `tail` leaves `head.next`
/// looking untouched. Believing that dropped the walk that gives the list back
/// and leaked all sixteen links.
fn stores_are_aimed(func: &Func, harmless: &rustc_hash::FxHashSet<String>) -> bool {
    func.blocks.iter().all(|block| {
        block.ops.iter().all(|value| {
            match &func.values[value.0 as usize].kind {
                OpKind::FieldSet { object, .. } => matches!(
                    func.values[object.0 as usize].kind,
                    OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } | OpKind::Param(_)
                ),
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => harmless.contains(name),
                // A global is reachable from inside any callee, and a call that
                // is not harmless can write through whatever it is handed.
                OpKind::GlobalSet { .. } | OpKind::Call { .. } => false,
                _ => true,
            }
        })
    })
}

/// Slots whose contents never need a count, and the values read out of them.
///
/// A frame object has no runtime destructor, so the counting pass emits by hand
/// the walk that gives its fields back. When a field holds *another* frame
/// object that walk is a load, a call and a branch to decide nothing -- the
/// storage of both ends with the frame whatever points at either.
///
/// `swap` is two such fields and `closure-capture` is one per iteration, and
/// together with `cycle` and `subclass-field` they were ninety operations, all
/// of them releases aimed at something that never reached the allocator.
///
/// # Why it has to be a fixpoint
///
/// `swap` stores `pair.b` into `pair.a` and back again, so what a slot holds is
/// a *load from another slot*, and neither can be settled before the other.
/// Assumed inert and contradicted, like every other safety property here: a
/// slot stops being inert when something is stored into it that is not a null,
/// not a frame object, and not a load from a slot that is still inert.
///
/// # What makes it sound
///
/// A store can only be aimed by naming something. If every `FieldSet` in the
/// function names an allocation or a parameter directly, a store hits exactly
/// the object it names -- two allocations are two objects, and a parameter was
/// bound before either existed -- so the stores recorded here are all the
/// stores there are. A store through a value that came out of a load could be
/// aimed anywhere, and gives up; so does a global, and so does a call that is
/// not `harmless`.
fn inert_slots(
    func: &Func,
    layouts: &[Layout],
    harmless: &rustc_hash::FxHashSet<String>,
) -> rustc_hash::FxHashSet<(ValueId, u32)> {
    let mut stored: rustc_hash::FxHashMap<(ValueId, u32), Vec<ValueId>> =
        rustc_hash::FxHashMap::default();
    for block in &func.blocks {
        for value in &block.ops {
            match &func.values[value.0 as usize].kind {
                OpKind::FieldSet {
                    object,
                    field,
                    value: put,
                    ..
                } => {
                    if !matches!(
                        func.values[object.0 as usize].kind,
                        OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } | OpKind::Param(_)
                    ) {
                        return rustc_hash::FxHashSet::default();
                    }
                    stored.entry((*object, *field)).or_default().push(*put);
                }
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } if harmless.contains(name) => {}
                // A callee can only write through what it is handed, so a call
                // handed nothing that can lead to an object cannot reach one.
                //
                // A string and a scalar are the whole of that: neither has a
                // reference field, so neither is a path to an allocation this
                // function made. The objects tracked here are `ObjectNew`s and
                // `ArrayNew`s of this function plus its parameters, and the
                // only way one of those reaches a callee is as an argument --
                // a store that put it somewhere else is a `FieldSet` recorded
                // above, and a global is `GlobalSet`, which still gives up.
                //
                // `caught-message` is what asked. Its `name` slot holds the
                // literal `"RangeError"` and nothing else, so the walk over the
                // dying error's fields loads an immortal word and releases it
                // -- seventeen times, once per call -- and the whole reason
                // that was not already elided is that the function also
                // concatenates two strings. Two string arguments, and the
                // blanket rule gave up the entire function for them.
                OpKind::Call { args, .. }
                    if args
                        .iter()
                        .all(|argument| !leads_to_an_object(&func.values[argument.0 as usize].ty)) => {}
                OpKind::GlobalSet { .. } | OpKind::Call { .. } => {
                    return rustc_hash::FxHashSet::default();
                }
                _ => {}
            }
        }
    }

    // Every reference slot of every allocation, assumed inert.
    let mut inert: rustc_hash::FxHashSet<(ValueId, u32)> = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        for value in &block.ops {
            if matches!(
                func.values[value.0 as usize].kind,
                OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
            ) {
                for field in reference_fields(func, layouts, *value) {
                    inert.insert((*value, field));
                }
            }
        }
    }

    loop {
        let mut doomed = Vec::new();
        for slot in &inert {
            let Some(puts) = stored.get(slot) else { continue };
            if !puts.iter().all(|put| costs_nothing(func, &inert, *put)) {
                doomed.push(*slot);
            }
        }
        if doomed.is_empty() {
            return inert;
        }
        for slot in doomed {
            inert.remove(&slot);
        }
    }
}

/// Whether a value is one nothing has to give back.
///
/// A null, an object that lives in the frame, or a read of a slot that only
/// ever holds one of those.
/// Whether a value of this type can be a path to an object with fields.
///
/// Deliberately a short allow-list rather than a deny-list: a type this does
/// not recognise answers `true` and gives up, which is the direction a wrong
/// answer here has to fail in.
fn leads_to_an_object(ty: &HirType) -> bool {
    !matches!(
        ty,
        HirType::Int { .. }
            | HirType::Float { .. }
            | HirType::Bool
            | HirType::Void
            | HirType::Managed(super::ManagedType::String)
    )
}

fn costs_nothing(
    func: &Func,
    inert: &rustc_hash::FxHashSet<(ValueId, u32)>,
    value: ValueId,
) -> bool {
    match &func.values[value.0 as usize].kind {
        // The last three are the immortal constants, which [`counted_here`]
        // already answers `false` for and this used to answer `true` for -- two
        // lists deciding one question and disagreeing about three of its cases.
        //
        // A string literal is static data the runtime treats as immortal, a
        // named function used as a value is one object for the whole program,
        // and a frame-placed call result ends with the frame. None of the three
        // has anything to give back, so a slot that only ever holds them has
        // nothing to give back either.
        //
        // `constant-field` is what measures it: an object literal in a frame
        // holding one string literal, whose walk over the dying object's fields
        // loaded it and released it -- a load, a call and a branch an
        // iteration, to read an immortal word and return.
        OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ObjectNew { frame: true }
        | OpKind::ConstString(_)
        | OpKind::ClosureStatic
        | OpKind::Call { frame: Some(_), .. } => true,
        OpKind::FieldGet { object, field, .. } => inert.contains(&(*object, *field)),
        // An erased value is the same value in a wider representation, so what
        // it costs is what the thing inside costs. The list above already
        // answers `true` for a static closure and answered `false` for one
        // stored into an erased slot -- which is every optional callback field,
        // because `fn?: (x) => y` is `T | undefined` and that is erased.
        //
        // Fourth sighting of one shape: 0091 found erasure hiding frame-locality
        // from the reference counter, 0095 found it hiding ownership transfer,
        // `deleted-field` has 51 against 17 waiting on it, and this is it hiding
        // *immortality*. Each time the fact was already computed and the
        // erasure was between it and the pass that wanted it.
        OpKind::Erase { value, .. } => costs_nothing(func, inert, *value),
        _ => false,
    }
}

/// Stores that write over a zero, evaluated at the point each one stands.
///
/// [`Fresh::initializing`] answers this for one store while a block is being
/// rebuilt. This answers it for every store in the function up front, because
/// two other questions need it and neither is inside that loop.
///
/// The second question is the interesting one. A store over a zero *adds* an
/// edge and removes none, so it cannot disconnect anything from anything: no
/// borrow anywhere can be invalidated by it. That is what makes a list buildable
/// without counting -- `tail.next = made` writes a slot `freshness` has already
/// proved is null, so the chain from the head only ever grows.
fn initializing_stores(
    func: &Func,
    layouts: &[Layout],
    entering: &[Fresh],
    harmless: &rustc_hash::FxHashSet<String>,
    starts_zero: &rustc_hash::FxHashSet<u32>,
) -> (
    rustc_hash::FxHashSet<ValueId>,
    Vec<rustc_hash::FxHashSet<(ValueId, u32)>>,
) {
    let mut settled = rustc_hash::FxHashSet::default();
    let mut still_zero = vec![rustc_hash::FxHashSet::default(); func.blocks.len()];
    // `initializing` is safe without this: `Fresh` drops a base the moment it is
    // handed anywhere, so a store *through* a name it is tracking is one it saw.
    // Claiming a slot is still a zero at the end is the stronger statement, and
    // needs every write in the function to be attributable. See
    // `stores_are_aimed`.
    let attributable = stores_are_aimed(func, harmless);
    // A module's top-level statements, which run once and before anything else.
    // `let kept: Config | null = null` is a store over a global that is already
    // null -- the static initializer put it there -- and the release of what it
    // found was a counted operation in every program with a module-level
    // reference. Only the entry block, because that is the block this function
    // is known to reach first.
    let mut untouched: rustc_hash::FxHashSet<u32> = if func.name == super::lower::MODULE_INIT {
        starts_zero.clone()
    } else {
        rustc_hash::FxHashSet::default()
    };
    for (at, block) in func.blocks.iter().enumerate() {
        let mut fresh = entering.get(at).cloned().unwrap_or_default();
        for value in &block.ops {
            let kind = func.values[value.0 as usize].kind.clone();
            if matches!(kind, OpKind::FieldSet { .. } | OpKind::ArraySet { .. })
                && fresh.initializing(func, &kind)
            {
                settled.insert(*value);
            }
            if at == 0 {
                match &kind {
                    OpKind::GlobalSet { global, .. } => {
                        if untouched.remove(global) {
                            settled.insert(*value);
                        }
                    }
                    // Anything a callee is handed can reach a global, and a
                    // body that is not here can reach one without being handed
                    // anything at all.
                    OpKind::Call {
                        callee: super::Callee::Direct(name),
                        ..
                    } if harmless.contains(name) => {}
                    OpKind::Call { .. } => untouched.clear(),
                    _ => {}
                }
            }
            fresh.observe(func, *value, &kind, harmless);
        }
        // What is still a zero where the block ends, which is where a frame
        // object's fields are given back. A field the program cleared on its
        // way out holds nothing, and walking it is a load and a release to
        // decide that.
        if attributable {
            for base in &fresh.bases {
                for field in reference_fields(func, layouts, *base) {
                    if !fresh.written.contains(&(*base, u64::from(field))) {
                        still_zero[at].insert((*base, field));
                    }
                }
            }
        }
    }
    (settled, still_zero)
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
/// A value a `Return` hands back is here too. It is alive until the return, so
/// it anchors perfectly well; what it must *not* get is the live-range stretch,
/// because a value both returned and released at the same exit is consumed
/// twice. [`anchors`] is where that line is drawn, and drawing it here instead
/// cost `traversal` and `local-anchor` their whole walk -- both build a list in
/// a helper and hand back the head, so the one value the cursor could anchor to
/// was the one value excluded.
///
/// Excludes loads, which are borrow candidates and are anchored by `settled`
/// one step further up instead.
fn entry_owned(func: &Func, layouts: &[Layout]) -> rustc_hash::FxHashSet<ValueId> {
    let Some(entry) = func.blocks.first() else {
        return rustc_hash::FxHashSet::default();
    };
    entry
        .ops
        .iter()
        .copied()
        .filter(|value| {
            counted(func, layouts, *value)
                && !is_load(&func.values[value.0 as usize].kind)
                // A function parameter is an op in the entry block like any
                // other, and it is the one thing here that must never be
                // released: the caller holds it for the length of the call.
                // Sweeping them in meant every closure's `this` had its live
                // range stretched to the exits and a release emitted there, so
                // `aCellPerIteration` gave 4 where node gives 9 -- a cell freed
                // while it was still being written through.
                //
                // They need no help from this set: `anchored` recognises a
                // parameter by name, before it asks about `owned` at all.
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
    // A returned value is alive until the return without any help, and giving
    // it the stretch would have it released at the same exit that hands it
    // back: one reference, two consumers.
    let returned: rustc_hash::FxHashSet<ValueId> = func
        .blocks
        .iter()
        .filter_map(|block| match block.terminator {
            super::Terminator::Return(Some(value)) => Some(value),
            _ => None,
        })
        .collect();
    let mut kept = rustc_hash::FxHashSet::default();
    for &value in crossing {
        let container = match &func.values[value.0 as usize].kind {
            OpKind::FieldGet { object, .. } => Some(*object),
            OpKind::ArrayGet { array, .. } => Some(*array),
            _ => None,
        };
        if let Some(container) = container
            && owned.contains(&container)
            && !returned.contains(&container)
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
                        && !returned.contains(arg)
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
/// it. A load survives only while its container is anchored and the slot goes
/// on holding what it holds, which is a claim about stores and calls and is not
/// circular at all.
fn crossing_borrows(
    func: &Func,
    layouts: &[Layout],
    mutates: &rustc_hash::FxHashSet<String>,
    owned: &rustc_hash::FxHashSet<ValueId>,
    initializing: &rustc_hash::FxHashSet<ValueId>,
    harmless: &rustc_hash::FxHashSet<String>,
    owns: &rustc_hash::FxHashSet<ValueId>,
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
            // Except a parameter this function *keeps*, which arrives owned
            // rather than borrowed and is handed on to the slot it is stored
            // into. See `consuming`.
            && !owns.contains(&value)
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
            initializing,
            harmless,
        };
        for &value in &crossing {
            let kind = &func.values[value.0 as usize].kind;
            if !is_load(kind) {
                continue;
            }
            let (container, field) = match kind {
                OpKind::FieldGet { object, field, .. } => (*object, Some(*field)),
                OpKind::ArrayGet { array, .. } => (*array, None),
                // A global is a slot with nothing to anchor to -- no container
                // whose life it shares -- so it is never borrowed for a whole
                // function. Block by block it still is, where `borrows_safely`
                // can see that nothing in between writes it, and that is how
                // `global-array` reaches zero.
                _ => {
                    doomed.push(value);
                    continue;
                }
            };
            if !anchored(func, &standing, container)
                || !slot_survives(
                    func, layouts, mutates, &standing, &unobserved, container, field, value,
                )
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
                //
                // And one that has been *put inside* something anchored is as
                // good again. That is the link a list has just been extended
                // with: stored into `tail.next` before it is carried round, so
                // the list is already holding it by the time the edge takes it,
                // and the retain the edge was doing was for a reference the
                // list had.
                if crossing.contains(param)
                    && !arriving.iter().all(|(_, args)| {
                        args.get(slot).is_some_and(|arg| {
                            crossing.contains(arg)
                                || owned.contains(arg)
                                || housed_safely(
                                    func, layouts, mutates, &standing, &unobserved, *arg,
                                )
                        })
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

/// What a block-local borrow decision needs about the rest of the function.
///
/// Two facts, read together because they are always wanted together: where
/// values are live, and which functions can overwrite a slot.
struct Surroundings<'a> {
    live: &'a liveness::Liveness,
    mutates: &'a rustc_hash::FxHashSet<String>,
    /// The same question for a dispatch, which has no single callee.
    mutating_slots: &'a rustc_hash::FxHashSet<u32>,
}

fn mutating(
    program: &Program,
) -> (rustc_hash::FxHashSet<String>, rustc_hash::FxHashSet<u32>) {
    let mut slots: rustc_hash::FxHashSet<u32> = rustc_hash::FxHashSet::default();
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
                // A dispatch reaches a store when some implementation in the
                // slot does, which is the same question asked of a set. Before
                // this it was `true` unconditionally, and the cost was not the
                // dispatch itself: a *direct* call to a method that merely
                // contains one inherited the answer through this fixpoint. So
                // `Shape#describe`, which stores nothing and calls
                // `this.area()`, counted as mutating -- and every borrow across
                // a call to it became a retain and a release.
                OpKind::Call {
                    callee: super::Callee::Virtual { slot, .. },
                    ..
                } => slots.contains(slot),
                // A helper the runtime marks `NTS_READS_ONLY` stores nothing,
                // which is the whole of what a borrow needs to survive it. The
                // comment above `mutating` named this as the coarse case and
                // said where the fact should live; `hir::runtime` carries it
                // now, checked against the header.
                OpKind::Call {
                    callee: super::Callee::External(name),
                    ..
                } => !super::runtime::reads_only(name),
                OpKind::Call { .. } => true,
                _ => false,
            });
            if reaches {
                mutates.insert(func.name.clone());
                grew = true;
            }
        }
        // The slots, from the functions, in the same round. A slot that gains an
        // implementation this round makes its callers mutating in the next one,
        // which is why the two cannot be computed one after the other.
        for layout in &program.layouts {
            for (slot, method) in layout.methods.iter().enumerate() {
                let Some(method) = method else { continue };
                let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                if mutates.contains(method) && slots.insert(slot) {
                    grew = true;
                }
            }
        }
        if !grew {
            return (mutates, slots);
        }
    }
}

/// Whether a value needs counting at all.
///
pub(super) fn counted(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    counted_from(func, layouts, value, &mut rustc_hash::FxHashSet::default())
}

/// The arguments every edge into a block carries, for one parameter slot.
fn arriving_on(func: &Func, block: usize, slot: usize) -> Option<Vec<ValueId>> {
    let mut arriving = Vec::new();
    for source in &func.blocks {
        let edges: Vec<(BlockId, &Vec<ValueId>)> = match &source.terminator {
            super::Terminator::Jump { target, args } => vec![(*target, args)],
            super::Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => vec![(*then_target, then_args), (*else_target, else_args)],
            _ => Vec::new(),
        };
        for (target, args) in edges {
            if target.0 as usize == block {
                // An edge that carries too few arguments is one this cannot
                // read, and a fact it cannot read is one it does not claim.
                arriving.push(*args.get(slot)?);
            }
        }
    }
    Some(arriving)
}

fn counted_from(
    func: &Func,
    layouts: &[Layout],
    value: ValueId,
    seen: &mut rustc_hash::FxHashSet<ValueId>,
) -> bool {
    let op = &func.values[value.0 as usize];
    if !op.ty.is_counted() {
        return false;
    }
    match op.kind {
        // A parameter of a block is whatever the edges into it carry, so it
        // costs what they cost. A `T | null` that is either a null or an object
        // in this frame is neither of them counted, and the release emitted for
        // it was a call per iteration to look at an immortal word and return.
        //
        // `early-return` is the case: a factory merged into its caller hands
        // back the object on one path and a null on the other, and the two meet
        // in the parameter the call became.
        //
        // A parameter reached only by itself contributes nothing and says so by
        // being already seen -- the answer is "not counted *because of this
        // edge*", and any other edge is still free to say otherwise.
        OpKind::BlockParam(slot) => {
            if !seen.insert(value) {
                return false;
            }
            let Some(block) = func
                .blocks
                .iter()
                .position(|block| block.params.get(slot as usize) == Some(&value))
            else {
                return true;
            };
            let Some(arriving) = arriving_on(func, block, slot as usize) else {
                return true;
            };
            arriving
                .into_iter()
                .any(|argument| counted_from(func, layouts, argument, seen))
        }
        // Erasing takes no reference of its own: an erased value is exactly
        // what it wraps, seen through a tag. So it costs what the wrapped value
        // costs, and asking that directly is sharper than the `true` this fell
        // through to -- `throw new Error(m)` caught in the same function erases
        // an object that lives in the frame, and the wrapper was retained on
        // the edge into the handler and released on both ways out of it.
        OpKind::Erase { value: inner, .. } => {
            // ...and a frame object is the case that argument was written for
            // and did not reach. It is counted -- see `counted_here` -- only so
            // that its own death emits the walk over its reference fields, and
            // an `Error` always has two, so the intended elision applied to
            // exactly nothing. The *name* emits no walk: `rc::release_value`
            // takes that branch on `ObjectNew { frame: true }` and this is an
            // `Erase`, so counting it is a retain and a release that each read
            // an immortal header and return.
            //
            // The duty stays with the object, which is where the walk is. What
            // makes that safe is the other half of this repair: liveness keeps
            // a frame object alive for as long as anything still names it, so
            // the walk is no longer emitted before the handler has read the
            // fields.
            if matches!(
                func.values[inner.0 as usize].kind,
                OpKind::ObjectNew { frame: true }
            ) {
                return false;
            }
            counted_from(func, layouts, inner, seen)
        }
        _ => counted_here(func, layouts, value),
    }
}

fn counted_here(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    let op = &func.values[value.0 as usize];
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
        // A string built into the caller's frame belongs here too, and for the
        // reason above it: `place_allocations` gives a call that storage only
        // where the result does not outlive the frame, `nts_str_place` marks it
        // `NTS_IMMORTAL`, and a string holds no references. Seventeen of these
        // were counted in `string-build` -- one release an iteration, for
        // storage that was never allocated.
        OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic
        | OpKind::Call { frame: Some(_), .. } => false,
        // A frame object has no count of its own -- it goes away when the frame
        // does, and counting it would at best be wasted work and at worst call
        // `free` on a stack address. But it still *ends*, and if it holds
        // references they have to be given up then. So it is tracked exactly
        // like anything else, and only the release differs.
        OpKind::ObjectNew { frame: true } => !reference_fields(func, layouts, value).is_empty(),
        _ => true,
    }
}

/// Whether this function holds a reference of its own to a value.
///
/// Everything counted is owned except a parameter, which the caller holds for
/// the length of the call. An owned value is retained where it is produced and
/// released where it dies; a borrowed one is neither.
pub(super) fn owned(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    counted(func, layouts, value) && !matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
}

/// Whether a producer already yields a reference the function owns.
pub(super) fn produces_owned(kind: &OpKind) -> bool {
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
pub(super) fn eliding() -> bool {
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
pub(super) fn inert(func: &Func) -> bool {
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
        // A helper the runtime marks `NTS_READS_ONLY` is a call and is none of
        // the four things this asks about: it reads through its arguments and
        // returns. `Stat.accessed` reads `this.atime` and hands it to
        // `nts_date_value`, which loads a double -- and that call alone made
        // the whole function not inert, so the borrow became a retain and a
        // release. 34 of `tooling/memory/cases/dates`' 51 operations.
        OpKind::Call {
            callee: super::Callee::External(name),
            ..
        } => super::runtime::reads_only(name),
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
/// Transitive, because a constructor calls its base's constructor. `super(t)`
/// is a call, and refusing every function that contains one left every derived
/// class outside the set -- so the first store to a field of a `Derived` loaded
/// the slot and released the null `Base` had written into it. A call to a
/// function that is itself in the set can do nothing this one could not.
///
/// A least fixpoint, so a recursive constructor never qualifies. That is the
/// safe direction and costs nothing real: a constructor that calls itself is
/// not the shape this exists for.
fn initializing_only(program: &Program, layouts: &[Layout]) -> rustc_hash::FxHashSet<String> {
    fn qualifies(
        func: &Func,
        layouts: &[Layout],
        harmless: &rustc_hash::FxHashSet<String>,
    ) -> bool {
        // Returning a *number* hands out no reference, so it says nothing about
        // what the function did to what it was given. Refusing it left every
        // accessor and every closure body outside the set -- `Closure0__call`
        // reads one field and returns a double, and its being excluded was the
        // whole of `closure-capture`'s seventeen operations.
        func.blocks.iter().all(|block| match block.terminator {
            super::Terminator::Return(Some(value)) => !counted(func, layouts, value),
            _ => true,
        })
            && func.values.iter().all(|op| match &op.kind {
                OpKind::FieldSet { value: stored, .. }
                | OpKind::ArraySet { value: stored, .. } => !counted(func, layouts, *stored),
                OpKind::GlobalSet { .. } => false,
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => harmless.contains(name),
                other => quiet(other),
            })
    }

    let mut harmless = rustc_hash::FxHashSet::default();
    loop {
        let mut grew = false;
        for func in &program.funcs {
            if !harmless.contains(&func.name) && qualifies(func, layouts, &harmless) {
                harmless.insert(func.name.clone());
                grew = true;
            }
        }
        if !grew {
            return harmless;
        }
    }
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
/// states the convention, so the two cannot drift silently. `unshift` is the
/// same operation at the other end and joins it here for the same reason.
///
/// **`nts_array_push_value` too**, which its header has always called
/// "consuming, like `nts_array_push_ref`" and which stores without a retain.
/// Missing from here, the caller released the reference the array had just
/// taken: twenty pushes of one object into an `unknown[]` left its count
/// where it was, and truncating the array freed it while another array still
/// held it -- invisible to valgrind for a managed object, whose freed memory
/// the runtime pools, and a `g_object_unref` of a freed `GObject` for a handle.
pub(super) fn consumes(name: &str) -> Option<usize> {
    match name {
        "nts_array_push_ref" | "nts_array_unshift_ref" | "nts_array_push_value" => Some(1),
        _ => None,
    }
}

/// Name the element a load or store is aimed at.
fn element(func: &Func, array: ValueId, index: ValueId) -> Slot {
    match slot_of(func, index) {
        Some(at) => Slot::At(array, at),
        None => Slot::Through(array, index),
    }
}

/// A store overwriting a slot a load came out of: the reference moves.
fn pair(
    held: &mut rustc_hash::FxHashMap<Slot, ValueId>,
    takes: &mut rustc_hash::FxHashSet<ValueId>,
    settled: &mut rustc_hash::FxHashSet<ValueId>,
    slot: Slot,
    store: ValueId,
    stored: ValueId,
) {
    if let Some(&taken) = held.get(&slot)
        && taken != stored
    {
        takes.insert(taken);
        settled.insert(store);
    }
    held.remove(&slot);
}

/// A slot a load can be taken out of, and a store aimed at.
///
/// A field is named by its container and its index. An element is named by its
/// array and either a constant or -- and this is the point -- the *value* the
/// index was computed into. Two reads of `slots[at]` with the same `at` are the
/// same slot, because SSA says one value is one number.
///
/// Two reads through *different* values might also be the same slot, which is
/// why a store through one gives up every element of that array rather than
/// only the one it names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Slot {
    Field(ValueId, u32),
    At(ValueId, u64),
    Through(ValueId, ValueId),
}

impl Slot {
    /// Whether this is an element rather than a field.
    fn is_element(self) -> bool {
        !matches!(self, Self::Field(..))
    }
}

/// The pending takes that reach a block, agreed across every way in.
///
/// A predecessor must either carry the take, or say the value is not there on
/// its own edge -- in which case taking it costs nothing on that path.
///
/// A join is where `Towers#pushDisk` lives: it reads the slot, tests two things
/// about what it found, and stores in the block after both arms come back
/// together. One predecessor at a time could never get a take that far.
fn arriving_at(
    func: &Func,
    at: usize,
    incoming: &[Vec<(BlockId, Vec<ValueId>)>],
    leaving: &[rustc_hash::FxHashMap<Slot, ValueId>],
    known_absent: &[rustc_hash::FxHashSet<ValueId>],
) -> rustc_hash::FxHashMap<Slot, ValueId> {
    let mut arriving: Option<rustc_hash::FxHashMap<Slot, ValueId>> = None;
    for (from, _) in &incoming[at] {
        let before = from.0 as usize;
        // A predecessor not yet reached is a back edge: it carries nothing, and
        // the meet below drops whatever it cannot vouch for.
        let carried: rustc_hash::FxHashMap<Slot, ValueId> = if before < at {
            let elsewhere: Vec<BlockId> = func.blocks[before]
                .terminator
                .successors()
                .into_iter()
                .filter(|to| to.0 as usize != at)
                .collect();
            leaving[before]
                .iter()
                .filter(|(_, pending)| {
                    elsewhere.iter().all(|to| {
                        // A block that ends the program is not somewhere a
                        // value has to be accounted for: nothing after it is
                        // observed. The same reason `crossing_borrows` treats
                        // an operation in an unreachable block as unobserved.
                        //
                        // It is the terminator that says so, not the call. A
                        // `throw` the function *catches* is a jump to the
                        // handler and its edge is accounted for like any
                        // other; only one that leaves ends in `Unreachable`.
                        func.blocks.get(to.0 as usize).is_some_and(|block| {
                            matches!(block.terminator, super::Terminator::Unreachable)
                        }) || proves_null(func, *from, to.0 as usize).contains(*pending)
                            || known_absent[before].contains(*pending)
                    })
                })
                .map(|(slot, pending)| (*slot, *pending))
                .collect()
        } else {
            rustc_hash::FxHashMap::default()
        };
        let mut absent_here = proves_null(func, *from, at);
        if before < at {
            absent_here.extend(known_absent[before].iter().copied());
        }
        arriving = Some(match arriving {
            None => carried,
            Some(so_far) => so_far
                .into_iter()
                .filter(|(slot, pending)| {
                    carried.get(slot) == Some(pending) || absent_here.contains(pending)
                })
                .collect(),
        });
    }
    arriving.unwrap_or_default()
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
    harmless: &rustc_hash::FxHashSet<String>,
) -> (
    rustc_hash::FxHashSet<ValueId>,
    rustc_hash::FxHashSet<ValueId>,
) {
    let mut takes = rustc_hash::FxHashSet::default();
    let mut settled = rustc_hash::FxHashSet::default();
    if !eliding() {
        return (takes, settled);
    }
    let incoming = super::loops::predecessors(func);
    let known_absent = absent_on_entry(func);
    let mut leaving: Vec<rustc_hash::FxHashMap<Slot, ValueId>> =
        vec![rustc_hash::FxHashMap::default(); func.blocks.len()];

    for (at, block) in func.blocks.iter().enumerate() {
        // A take says the slot has given up what it held. If the store that
        // overwrites the slot does not happen on some path, the slot still holds
        // the reference while the value claims it, and one of the two loses --
        // unless the value is null there, which costs nothing to claim. A
        // nullable reference in TypeScript is *tested* before it is used, so the
        // arm where the test says no is exactly where the compiler already knows
        // it is absent.
        //
        // That is the whole of `popDiskFrom`: read `slots[at]`, return early if
        // it is null, and otherwise overwrite the slot in the block after the
        // branch. See `arriving_at`.
        let mut held = arriving_at(func, at, &incoming, &leaving, &known_absent);
        for &value in &block.ops {
        // A borrow may not also take. `crossing` says nothing releases this
        // value and no edge retains for it; taking would make it owned, and
        // three rules disagreeing about one value is how a reference gets
        // consumed twice.
        let takeable = counted(func, layouts, value) && !crossing.contains(&value);
        match &func.values[value.0 as usize].kind {
            OpKind::FieldGet { object, field, .. } => {
                if takeable {
                    held.insert(Slot::Field(*object, *field), value);
                }
            }
            OpKind::ArrayGet { array, index, .. } => {
                if takeable {
                    held.insert(element(func, *array, *index), value);
                }
            }
            OpKind::FieldSet {
                object,
                field,
                value: stored,
                ..
            } => {
                pair(&mut held, &mut takes, &mut settled, Slot::Field(*object, *field), value, *stored);
            }
            OpKind::ArraySet {
                array,
                index,
                value: stored,
                ..
            } => {
                let slot = element(func, *array, *index);
                pair(&mut held, &mut takes, &mut settled, slot, value, *stored);
                // Every element read so far gives up, whatever array it came
                // from. Two arrays are told apart here by the *value* naming
                // them, and two loads of `this.slots` are two values naming one
                // array -- so a store through either can overwrite a slot read
                // through the other, and taking from it afterwards would give
                // away a reference the store had already given up.
                //
                // The old code kept slots of other arrays for exactly this
                // reason and was wrong about it too, at constant indices; the
                // hazard was just rarer. A field store cannot reach an element,
                // so fields stay.
                held.retain(|held_slot, _| !held_slot.is_element());
            }
            // A call that only initializes cannot reach a slot this is
            // watching. Clearing for one lost the take in every constructor
            // shaped like `x = o.f; o.f = new T(...)`, which is most of them:
            // the allocation is fine and the constructor call between the load
            // and the store is what threw the pairing away.
            OpKind::Call {
                callee: super::Callee::Direct(name),
                ..
            } if harmless.contains(name) => {}
            other => {
                // `quiet` is the wrong question here, and asking it cost every
                // take in `x = o.f; o.f = new T(...)` -- the commonest shape
                // there is. `quiet` means "cannot store, call, allocate or
                // suspend", because `inert` needs a function that makes no
                // garbage. What this needs is narrower: cannot write a *slot*.
                // An allocation writes nothing that already exists, and a
                // repackaging is one pointer under another name.
                let cannot_write = quiet(other)
                    || repackages(other)
                    || matches!(other, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. });
                if !cannot_write {
                    held.clear();
                }
            }
            }
        }
        leaving[at] = held;
    }
    (takes, settled)
}

/// Fields of a returned object that are null on the way out.
///
/// `popDiskFrom` ends `top.next = null; return top`, so it hands back a disk
/// whose `next` is a zero -- and the caller that links it into a list can store
/// over that slot without giving anything back.
fn returns_nulled(func: &Func, layouts: &[Layout]) -> rustc_hash::FxHashSet<u32> {
    let mut agreed: Option<rustc_hash::FxHashSet<u32>> = None;
    for block in &func.blocks {
        let super::Terminator::Return(Some(handed)) = block.terminator else {
            continue;
        };
        // A path that hands back a null constrains nothing: there is no object
        // for a caller to store into. Bailing on it gave up on every
        // `T | null` function, which is every one this matters for.
        if !counted(func, layouts, handed) {
            continue;
        }
        // Last write wins, and only a write this function can see counts: the
        // same "a store is aimed by naming something" rule `inert_slots` uses.
        let mut nulled = rustc_hash::FxHashSet::default();
        for other in &func.blocks {
            for value in &other.ops {
                match &func.values[value.0 as usize].kind {
                    OpKind::FieldSet {
                        object,
                        field,
                        value: put,
                        ..
                    } if *object == handed => {
                        if matches!(func.values[put.0 as usize].kind, OpKind::ConstNull) {
                            nulled.insert(*field);
                        } else {
                            nulled.remove(field);
                        }
                    }
                    // A store aimed at a directly-named allocation or
                    // parameter hits that object and no other, so it says
                    // nothing about this one.
                    OpKind::FieldSet { object, .. }
                        if matches!(
                            func.values[object.0 as usize].kind,
                            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } | OpKind::Param(_)
                        ) => {}
                    // Anything else is aimed through a value that came out of a
                    // load, which could be this object under another name.
                    OpKind::FieldSet { .. } => {
                        return rustc_hash::FxHashSet::default();
                    }
                    _ => {}
                }
            }
        }
        agreed = Some(match agreed {
            None => nulled,
            Some(before) => before.intersection(&nulled).copied().collect(),
        });
    }
    agreed.unwrap_or_default()
}

/// Parameter fields every caller has already zeroed.
///
/// A store into `p.f` gives back what `p.f` was holding, and a parameter is
/// opaque -- so linking a freshly detached node into a list pays a load and a
/// release of a null on every call. `pushDisk` does exactly that on each of
/// `awfy-towers`' eight thousand moves, and pricing it with an unsound control
/// put the row at 2.36x C++ against 3.05x.
///
/// A greatest fixpoint over call sites: assumed zero, and contradicted by a
/// caller that passes something it cannot vouch for. A function nothing calls
/// keeps the assumption, which is safe -- there is no caller to be wrong about.
///
/// What a caller can vouch for: a fresh allocation whose field it has not
/// written, and the result of a call that nulls the field on its way out.
fn zeroed_parameters(
    program: &Program,
    layouts: &[Layout],
    harmless: &rustc_hash::FxHashSet<String>,
) -> rustc_hash::FxHashMap<String, rustc_hash::FxHashSet<(u32, u32)>> {
    let nulled: rustc_hash::FxHashMap<&str, rustc_hash::FxHashSet<u32>> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), returns_nulled(func, layouts)))
        .collect();

    let mut zeroed: rustc_hash::FxHashMap<String, rustc_hash::FxHashSet<(u32, u32)>> = program
        .funcs
        .iter()
        .map(|func| {
            let mut slots = rustc_hash::FxHashSet::default();
            for (slot, _) in func.params.iter().enumerate() {
                let Ok(slot) = u32::try_from(slot) else {
                    continue;
                };
                for field in reference_fields(func, layouts, ValueId(slot)) {
                    slots.insert((slot, field));
                }
            }
            (func.name.clone(), slots)
        })
        .collect();

    loop {
        let mut doomed: Vec<(String, (u32, u32))> = Vec::new();
        for caller in &program.funcs {
            let mut fresh = Fresh::entering(caller, layouts, BlockId(0), &rustc_hash::FxHashSet::default());
            for block in &caller.blocks {
                for value in &block.ops {
                    let kind = caller.values[value.0 as usize].kind.clone();
                    if let OpKind::Call {
                        callee: super::Callee::Direct(name),
                        args,
                        ..
                    } = &kind
                        && let Some(claimed) = zeroed.get(name)
                    {
                        for (slot, field) in claimed {
                            let Some(given) = args.get(*slot as usize) else {
                                continue;
                            };
                            let vouched = match &caller.values[given.0 as usize].kind {
                                OpKind::Call {
                                    callee: super::Callee::Direct(from),
                                    ..
                                } => nulled.get(from.as_str()).is_some_and(|f| f.contains(field)),
                                _ => {
                                    fresh.bases.contains(given)
                                        && !fresh.written.contains(&(*given, u64::from(*field)))
                                }
                            };
                            if !vouched {
                                doomed.push((name.clone(), (*slot, *field)));
                            }
                        }
                    }
                    fresh.observe(caller, *value, &kind, harmless);
                }
            }
        }
        if doomed.is_empty() {
            return zeroed;
        }
        for (name, slot) in doomed {
            if let Some(slots) = zeroed.get_mut(&name) {
                slots.remove(&slot);
            }
        }
    }
}

/// Parameter slots a function takes ownership of.
///
/// The `consumes` column of record 0024's summary, for the functions that have
/// HIR to read it off -- `consumes` already answers it for the runtime helpers
/// that do not.
///
/// A parameter stored into a slot is one the callee is keeping. Today the callee
/// retains it, because a parameter is borrowed and a store needs a reference of
/// its own, and the caller releases the value a moment later: two operations to
/// move a reference across a call. `Piles#push` is that on every one of its
/// hundred and thirty eight calls, and `pushDisk` on every one of `awfy-towers`'
/// eight thousand.
///
/// # Exactly one store, dominating every return
///
/// The two sides have to agree unconditionally -- the callee stops retaining
/// whatever happens, so the caller must hand over a reference whatever happens.
/// That needs the store to run on *every* path out, which is what dominating
/// each `Return` means, and to run *once*, which is why a second store anywhere
/// disqualifies the parameter: two stores need two references and the caller is
/// handing over one.
/// Whether control can come back round to a block.
///
/// A store that takes the caller's reference may run once. Run it twice on one
/// handed-over reference and the second take is a reference nobody had.
fn reaches_itself(func: &Func, block: BlockId) -> bool {
    let mut seen = rustc_hash::FxHashSet::default();
    let mut front: Vec<BlockId> = func.blocks[block.0 as usize].terminator.successors();
    while let Some(at) = front.pop() {
        if at == block {
            return true;
        }
        if !seen.insert(at) {
            continue;
        }
        if let Some(next) = func.blocks.get(at.0 as usize) {
            front.extend(next.terminator.successors());
        }
    }
    false
}

fn consuming(func: &Func, layouts: &[Layout]) -> rustc_hash::FxHashSet<u32> {
    let mut consumed = rustc_hash::FxHashSet::default();
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let dominates = |over: BlockId, under: BlockId| {
        let mut at = Some(under);
        while let Some(block) = at {
            if block == over {
                return true;
            }
            at = idom[block.0 as usize];
        }
        false
    };

    for (slot, _) in func.params.iter().enumerate() {
        let Ok(slot) = u32::try_from(slot) else { continue };
        let parameter = ValueId(slot);
        if !counted(func, layouts, parameter) {
            continue;
        }
        let mut stores = Vec::new();
        for (at, block) in func.blocks.iter().enumerate() {
            for value in &block.ops {
                let put = match &func.values[value.0 as usize].kind {
                    OpKind::FieldSet { value: put, .. }
                    | OpKind::ArraySet { value: put, .. }
                    | OpKind::GlobalSet { value: put, .. } => *put,
                    _ => continue,
                };
                if put == parameter {
                    stores.push(BlockId(u32::try_from(at).unwrap_or(u32::MAX)));
                }
            }
        }
        // One block, however many stores are in it.
        //
        // A constructor puts the same argument in two slots -- `this.label` and
        // `this.spare` -- and needed two references where the caller was
        // holding one, so it retained twice and the caller released after. The
        // arithmetic never needed that: the callee needs one reference per
        // slot, is handed one, and owes itself the rest. `rc` already emits
        // exactly that, because at most one store per value may claim the
        // value's death and every other store copies.
        //
        // What the stores may not do is disagree about *whether* they ran. Two
        // stores on two arms of a branch would each want the handed-over
        // reference, and the arm that did not take it would leak. One block
        // that dominates every return means all of them ran, once.
        let Some(only) = stores.first().copied() else {
            continue;
        };
        if stores.iter().any(|at| *at != only) || reaches_itself(func, only) {
            continue;
        }
        let returns_covered = func
            .blocks
            .iter()
            .enumerate()
            .filter(|(at, block)| {
                matches!(block.terminator, super::Terminator::Return(_))
                    && reachable.contains(&BlockId(u32::try_from(*at).unwrap_or(u32::MAX)))
            })
            .all(|(at, _)| dominates(only, BlockId(u32::try_from(at).unwrap_or(u32::MAX))));
        if returns_covered {
            consumed.insert(slot);
        }
    }
    consumed
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
/// Runtime helpers whose result is the receiver they were handed.
///
/// [`hands_back_a_parameter`] reads the program's own functions, and these are
/// not among them: they are C, and the compiler knows them by name only. Each
/// returns its receiver because JavaScript says the call evaluates to it --
/// `m.set(k, v)` *is* `m`, which is what lets `m.set(a, 1).set(b, 2)` chain --
/// and almost every call site throws that away.
///
/// Unnamed here, each discarded result cost a retain in the callee and a
/// release in the caller for a reference the caller held the whole time. On
/// `map-and-set` that was 436,590 calls into `nts_release`, an eighth of the
/// benchmark, to hand back a table that was never going anywhere.
///
/// Adding a name here is half a change. The callee has to stop retaining, or
/// the count goes the other way -- see `nts_map_same` and `nts_array_same`,
/// which is where the retain used to be and why.
const RUNTIME_HANDS_BACK: &[&str] = &[
    "nts_array_fill",
    "nts_array_fill_bool",
    "nts_array_fill_ref",
    "nts_array_fill_foreign",
    "nts_array_reverse",
    "nts_array_reverse_ref",
    // Missing from here until 2026-09-25, while it returned through
    // `nts_array_same` like the rest: every `xs.sort()` released the array
    // twice. Both releases came after the last read while a release waited
    // for the block's end; releasing at the last use freed the array before
    // `xs[1]` read it.
    "nts_array_sort_str",
    // `Object.assign(target, source)`, which answers the target. Missing on
    // the day it landed, and found the same way `sort` was; the test below
    // now reads the runtime for any helper like it.
    "nts_map_extend",
    "nts_map_set",
    "nts_set_add",
];

/// Runtime helpers whose result is a reference read **out of a slot of** one of
/// their arguments.
///
/// Not the argument itself, which is what [`RUNTIME_HANDS_BACK`] names. A
/// promise's fulfilled value and its rejection reason are *fields*, and the
/// ownership consequence is identical for the reason `is_load`'s neighbours
/// give: the reference belongs to the slot, the slot's container is an operand
/// of this call, and the caller is holding it. So it is merged into the same set
/// and gets the same `safely()` question.
///
/// **The callee is right and the caller was wrong**, which is why this list
/// exists rather than three retains in the runtime. `runtime/c/tests/erased.c`
/// asserts the contract deliberately -- *"reading does not retain again"* and
/// *"releasing the promise releases the string"* -- with a comment stating that a
/// reference "is retained on the way in and released with the promise, through
/// the slot the descriptor already knows about". `nts_promise_fulfill` and
/// `nts_promise_reject` each retain, so the promise owns exactly one count.
///
/// Without this the result was `Produced`, and the comment at that arm already
/// says what that is: *"`Produced` would be wrong and is a use-after-free: the
/// callee stops retaining unconditionally, so there is no reference here to have
/// been produced."* True of these three as written, and it was.
///
/// Found under `--rc` with `ASan` by the GTK lane, from
/// `g_file_make_directory_finish` failing an assertion on a heap corrupted long
/// before. It reduces to **`await` on a promise fulfilled with an object** --
/// twelve lines, no rejection, no `catch` -- which is the most ordinary async
/// shape there is. Invisible without RC, the cycle collector reaching the
/// promise at a checkpoint, and the freed bytes reused.
const RUNTIME_LENDS_A_SLOT: &[&str] = &[
    // The object holding an Objective-C instance's fields, which its ivar
    // holds: a slot of the receiver, and the receiver is an operand.
    "nts_objc_state",
    // A GObject subclass's, which its instance holds at the offset its
    // registration gave: a slot of the receiver, as the Objective-C one is.
    "nts_gobject_state",
    // A composed Windows Runtime instance's, which its outer object holds.
    "nts_com_state",
    "nts_promise_value",
    "nts_promise_reference",
    "nts_promise_reason",
];

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
        .chain(RUNTIME_HANDS_BACK.iter().map(|name| (*name).to_string()))
        .chain(RUNTIME_LENDS_A_SLOT.iter().map(|name| (*name).to_string()))
        .collect()
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
/// Whether a counted handle converted to another counted type -- a `GtkBox *`
/// as the `GtkWidget *` an inherited method takes -- can borrow the reference
/// the handle holds rather than take one of its own.
///
/// It is the same object, and liveness keeps the handle alive wherever the
/// view is used (`viewed` there), so what the view needs is that the handle's
/// reference is one nothing else can end early: a parameter, which the caller
/// holds for the call; a foreign call's result that this function reads,
/// which it owns and gives back only where liveness says it dies; or a
/// borrow that crosses its whole life ([`crossing_borrows`]) -- a load whose
/// slot survives everything reachable after it, not only its own uses, and a
/// block parameter whose anchors liveness stretches over the view as it does
/// over the borrow. A chain of views goes back to its handle. Anything else --
/// a load borrowed block by block (`borrows_safely`, argued over its direct
/// uses only) -- takes its own, as before.
///
/// `box.get_visible()` in a loop paid `g_object_ref_sink` and
/// `g_object_unref` for the upcast receiver on every call: 45-55 ns against
/// 5-6 ns for the call alone, measured against GTK. The crossing case is the
/// common one: a handle a closure captured is a load from its environment,
/// and `tooling/gtk-bench`'s `method` row went from 20.3 ns to 4.1 (C: 7.3). A view that escapes -- is
/// stored, returned, passed on an edge -- is retained there, as any borrowed
/// value is.
fn views_borrow(func: &Func, value: ValueId, crossing: &rustc_hash::FxHashSet<ValueId>) -> bool {
    let counted = |v: ValueId| func.values[v.0 as usize].ty.counting().is_some();
    if !eliding() || !counted(value) {
        return false;
    }
    let mut at = value;
    // Bounded: a chain of views is as long as a class hierarchy.
    for _ in 0..64 {
        let OpKind::Convert(operand) = func.values[at.0 as usize].kind else { break };
        if !counted(operand) {
            return false;
        }
        at = operand;
    }
    if at == value {
        return false;
    }
    crossing.contains(&at)
        || matches!(
            func.values[at.0 as usize].kind,
            OpKind::Param(_) | OpKind::Call { callee: super::Callee::Native(_), .. }
        )
}

pub(super) fn repackages(kind: &OpKind) -> bool {
    matches!(kind, OpKind::Erase { .. } | OpKind::Unerase { .. })
}

pub(super) fn is_load(kind: &OpKind) -> bool {
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
            // A dispatch, where the callee is a slot rather than a name. Safe
            // when no implementation in the slot stores anything -- the same
            // question `mutates` answers for a direct call, asked of the whole
            // set because that is what can be reached.
            OpKind::Call {
                callee: super::Callee::Virtual { slot, .. },
                ..
            } => around.mutating_slots.contains(slot),
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
fn freshness(
    func: &Func,
    layouts: &[Layout],
    harmless: &rustc_hash::FxHashSet<String>,
    zeroed: &rustc_hash::FxHashSet<(u32, u32)>,
) -> Vec<Fresh> {
    /// Enough rounds for any reducible graph; reaching it would be a bug, and
    /// looping forever would hide it.
    const ROUNDS: usize = 1024;

    let count = func.blocks.len();
    let incoming = super::loops::predecessors(func);
    let mut entry: Vec<Option<Fresh>> = vec![None; count];
    if count > 0 {
        entry[0] = Some(Fresh::entering(func, layouts, BlockId(0), zeroed));
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
    fn entering(
        func: &Func,
        layouts: &[Layout],
        block: BlockId,
        zeroed: &rustc_hash::FxHashSet<(u32, u32)>,
    ) -> Self {
        let mut fresh = Self::default();
        // A parameter whose fields every caller has already zeroed is, for
        // those fields, exactly as good as a fresh allocation. See
        // `zeroed_parameters`. The fields nobody vouched for are marked written
        // straight away, so the base says only what was actually promised.
        if block == BlockId(0) {
            for (slot, _) in zeroed {
                let parameter = ValueId(*slot);
                fresh.bases.insert(parameter);
                for field in reference_fields(func, layouts, parameter) {
                    if !zeroed.contains(&(*slot, field)) {
                        fresh.written.insert((parameter, u64::from(field)));
                    }
                }
            }
        }
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
            OpKind::FieldSet {
                object,
                field,
                value: stored,
                ..
            } => {
                // Storing a null puts the slot back the way the allocator left
                // it, so the *next* store to it writes over a zero and owes no
                // release. Recording it as written meant a field cleared and
                // refilled in a loop loaded and released a null every time
                // round -- `nulled-field` pays one an iteration for exactly
                // that.
                if matches!(func.values[stored.0 as usize].kind, OpKind::ConstNull) {
                    self.written.remove(&(*object, u64::from(*field)));
                } else {
                    self.written.insert((*object, u64::from(*field)));
                }
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
pub(super) fn slot_of(func: &Func, index: ValueId) -> Option<u64> {
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


/// The indices of a value's reference fields, in layout order.
pub(super) fn reference_fields(func: &Func, layouts: &[Layout], value: ValueId) -> Vec<u32> {
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
        // A counted handle too: a frame object that ends gives up the objects
        // its fields hold, whichever system counts them.
        .filter(|(_, field)| field.ty.is_counted())
        .filter_map(|(index, _)| u32::try_from(index).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    /// Helpers that return a parameter and are rightly not in
    /// [`super::RUNTIME_HANDS_BACK`], each for its reason.
    const NOT_HANDED_BACK: &[(&str, &str)] = &[
        ("nts_str_place", "writes into the frame buffer it is given, which holds no count"),
        ("nts_str_append", "takes its left side's reference (a move) and hands that back"),
        ("nts_array_same", "the helper the listed array ones return through"),
        ("nts_map_same", "the helper the listed table ones return through"),
        ("nts_array_fill_counted", "the body `nts_array_fill_ref` and `_foreign` share, both listed"),
    ];

    /// The runtime's pointer-returning `nts_*` definitions that return one of
    /// their own parameters, directly or through `nts_*_same`, without
    /// retaining it: each hands back what the caller already holds.
    fn handing_back(source: &str) -> Vec<String> {
        let lines: Vec<&str> = source.lines().collect();
        let mut found = Vec::new();
        let mut at = 0;
        while at < lines.len() {
            let line = lines[at];
            let starts = line.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && line.contains("nts_") && line.contains('(');
            if !starts || line.starts_with("typedef") {
                at += 1;
                continue;
            }
            let mut signature = line.trim().to_owned();
            let mut end = at;
            while !signature.ends_with('{') && !signature.ends_with(';') && end + 1 < lines.len() {
                end += 1;
                signature.push(' ');
                signature.push_str(lines[end].trim());
            }
            at = end + 1;
            let Some(open) = signature.find('(') else { continue };
            if !signature.ends_with('{') {
                continue;
            }
            let head = &signature[..open];
            let Some(name) = head.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).rfind(|w| w.starts_with("nts_")) else { continue };
            if !head.contains('*') {
                continue;
            }
            let close = signature.rfind(')').unwrap_or(signature.len());
            let parameters: Vec<&str> = signature[open + 1..close]
                .split(',')
                .filter_map(|p| p.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).rfind(|w| !w.is_empty()))
                .filter(|p| *p != "void")
                .collect();
            let mut body = String::new();
            while at < lines.len() && lines[at] != "}" {
                body.push_str(lines[at]);
                body.push('\n');
                at += 1;
            }
            let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            for parameter in parameters {
                let direct = compact.contains(&format!("return{parameter};"));
                let through = ["array", "map"].iter().any(|kind| compact.contains(&format!("returnnts_{kind}_same({parameter});")));
                let retained = compact.contains(&format!("nts_retain({parameter}")) || compact.contains(&format!("nts_retain((NtsHeader*){parameter}"));
                if (direct || through) && !retained {
                    found.push(name.to_owned());
                }
            }
        }
        found
    }

    /// Every helper that hands back what it was given is listed, or exempt
    /// with its reason: the caller otherwise counts the result as its own and
    /// releases it once too often. Two did so for as long as releases waited
    /// for their block's end, which put the extra release after every read;
    /// `sort` and `Object.assign` crashed the day releases moved to the last
    /// use. Reading the runtime is what finds the next one on the day it lands.
    #[test]
    fn every_helper_that_hands_back_an_argument_is_listed() {
        let source = include_str!("../../../../runtime/c/nts_runtime.c");
        let found = handing_back(source);
        assert!(found.iter().any(|name| name == "nts_array_sort_str"), "the scan finds nothing: {found:?}");
        let unlisted: Vec<&String> = found
            .iter()
            .filter(|name| !super::RUNTIME_HANDS_BACK.contains(&name.as_str()))
            .filter(|name| !NOT_HANDED_BACK.iter().any(|(exempt, _)| exempt == name))
            .collect();
        assert!(unlisted.is_empty(), "these return an argument unretained and are not in RUNTIME_HANDS_BACK: {unlisted:?}");
    }
}
