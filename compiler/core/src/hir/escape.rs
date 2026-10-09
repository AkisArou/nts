//! Which references outlive the frame that made them.
//!
//! # What it is for
//!
//! An object whose reference never leaves the function that allocated it does
//! not need to be on the heap. It can live in the frame, which costs a stack
//! pointer adjustment instead of a call to the allocator, needs no reference
//! counting, and lets the C compiler see the whole object at once — at which
//! point it usually stops being an object at all and becomes a few registers.
//!
//! The `objects` benchmark is what makes this concrete: a loop body of three
//! arithmetic operations, wrapped in a malloc, a memset, a call and a free.
//! clang deletes exactly this allocation in the hand-written C, and V8
//! scalar-replaces it in the JavaScript. Both read the same fact off the same
//! program, and it is the fact this module computes.
//!
//! # The rule
//!
//! A reference escapes when it is stored where something else can reach it, or
//! handed to something that will do so:
//!
//! - stored into a field or an element — the container outlives the store;
//! - returned;
//! - passed along an edge *only* where the parameter it lands in escapes, or
//!   where the value was made inside a loop and that parameter is still live
//!   where it is made -- one frame slot cannot hold two results anyone can
//!   still read. This used to say "because a block parameter is a value this
//!   analysis does not follow", and it followed nothing: see [`hand_on`];
//! - passed to a call in a position that callee lets escape.
//!
//! Reading *through* a reference is not escaping. `o.x`, `xs[i]` and `xs.length`
//! take the container as an operand and hand it to nobody, which is why a
//! constructor writing its own fields and a method reading them both keep their
//! receiver in the frame.
//!
//! # Why it needs a fixpoint
//!
//! The last rule reads a callee's answer, and a callee may be the caller. `walk`
//! calling itself with the same node is the ordinary case. Every parameter
//! starts as *not* escaping and is moved to escaping when something shows that
//! it does, which is the least fixpoint — and it is the safe direction to
//! iterate from only because the loop runs to convergence. Reading the answer
//! before it converges would read "does not escape" from a parameter nothing has
//! looked at yet.
//!
//! # Where it has to stop
//!
//! At an external callee, whose body is not here: every reference passed to one
//! escapes. An **exported** function is not the same wall — its callers are
//! outside, but a caller cannot make a *parameter* escape, only the callee's own
//! body can. What an exported function does with its parameters is visible here
//! like any other.

//! Native storage has explicit placement: `NativeLocal` is stack storage and
//! `NativeMalloc` is manually released heap storage. This analysis does not
//! choose their placement or cleanup. `native_storage::check` enforces local
//! pointer lifetimes before suspension and again in HIR verification, including
//! field/element addresses and block-argument aliases; unknown uses refuse.

use rustc_hash::{FxHashMap, FxHashSet};

use super::liveness;
use super::{BlockId, Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, ValueId};

/// A bound on the call-graph iteration. Convergence takes a handful of rounds --
/// the lattice is two points per parameter and only moves one way -- so reaching
/// this means a bug, and looping forever would hide it.
const ROUND_CAP: u32 = 32;

/// Values produced by an operation that can run more than once.
///
/// A frame allocation is a single slot, so confining one is a claim that at
/// most one of its results is live at a time. That holds for a straight-line
/// allocation and fails for one inside a cycle: the slot is reused, and
/// anything that kept the previous result is now looking at the current one.
///
/// A block is in a cycle when it can reach itself. That is all this needs to
/// know -- not which loop, not how many iterations. It is used only to *refuse*
/// confinement, so an over-approximation costs a heap allocation and never an
/// answer.
fn repeats(func: &Func) -> FxHashSet<ValueId> {
    let count = func.blocks.len();
    // Reachability between blocks, transitively.
    let mut reaches: Vec<FxHashSet<usize>> = vec![FxHashSet::default(); count];
    for (at, block) in func.blocks.iter().enumerate() {
        for target in block.terminator.successors() {
            let target = target.0 as usize;
            if target < count {
                reaches[at].insert(target);
            }
        }
    }
    let mut changed = true;
    while changed {
        changed = false;
        for at in 0..count {
            let seen: Vec<usize> = reaches[at].iter().copied().collect();
            for step in seen {
                let onward: Vec<usize> = reaches[step].iter().copied().collect();
                for next in onward {
                    if reaches[at].insert(next) {
                        changed = true;
                    }
                }
            }
        }
    }
    let mut repeated = FxHashSet::default();
    for (at, block) in func.blocks.iter().enumerate() {
        if reaches[at].contains(&at) {
            repeated.extend(block.ops.iter().copied());
        }
    }
    repeated
}

/// What escapes, per function.
#[derive(Debug, Clone, Default)]
pub struct Escapes {
    /// Values whose reference outlives this frame.
    values: FxHashSet<ValueId>,
    /// Values handed to a callee that reads their fields out and lets what it
    /// read escape: what is *in* them leaves, and they themselves need not. Kept
    /// so [`leaks_its_fields`] can publish a parameter this frame only forwards.
    contents_leave: FxHashSet<ValueId>,
}

impl Escapes {
    /// Whether a value's reference outlives the frame that made it.
    #[must_use]
    pub fn escapes(&self, value: ValueId) -> bool {
        self.values.contains(&value)
    }

    /// Whether an allocation can live in the frame.
    ///
    /// An object holding references can, and it costs something: what those
    /// slots hold has to be given up where the object's live range ends, which
    /// is what the runtime does when it destroys a heap object and what the
    /// compiler emits instead when there is no heap object to destroy.
    #[must_use]
    pub fn is_frame_local(&self, value: ValueId) -> bool {
        !self.values.contains(&value)
    }
}

/// Parameters a function stores into another parameter's field.
///
/// `Config#constructor` is `this.label = label`, which is every constructor that
/// takes a reference. The store's container is a *parameter*, so it is not an
/// allocation this function can confine, and the value went to the heap -- for
/// every caller, however local its object was.
///
/// It is not this function's question. What the stored value escapes into is
/// the container, and whether *that* outlives anything is the caller's answer.
/// So the pair is published and the caller adds the edge, which is the same
/// "if the container escapes, so does what is in it" the stores already use --
/// one call further out.
fn stores_into(func: &Func) -> Vec<(u32, u32)> {
    let mut pairs = Vec::new();
    for block in &func.blocks {
        for value in &block.ops {
            let (container, stored) = match &func.values[value.0 as usize].kind {
                OpKind::FieldSet {
                    object,
                    value: stored,
                    ..
                }
                | OpKind::ArraySet {
                    array: object,
                    value: stored,
                    ..
                } => (*object, *stored),
                _ => continue,
            };
            if let OpKind::Param(into) = func.values[container.0 as usize].kind
                && let OpKind::Param(what) = func.values[stored.0 as usize].kind
            {
                pairs.push((what, into));
            }
        }
    }
    pairs
}

/// Parameter slots whose *contents* leave, because this body reads a field of one
/// and lets what it read escape.
///
/// The third obligation a callee publishes, beside [`stores_into`] and
/// [`returned_params`], and the one that was missing. `FieldSet`'s rule is "what
/// goes in is reachable from wherever the container is -- and *no further*", so a
/// container this function allocated and confines keeps its contents in the
/// frame. That sentence is false for a container **passed to a function that
/// copies its fields out**, and nothing said so:
///
/// ```ts
/// let heard = "";
/// const make = (title: string) => () => { heard += title };
/// handlers.push(make("A"));            // handlers outlives the block
/// ```
///
/// `make`'s closure is an allocation `build` confines, so the cell holding
/// `heard` was confined with it -- on the **stack**, `NTS_IMMORTAL`. But
/// `make`'s body reads the cell out of its own receiver and stores it in the
/// closure it returns, which is pushed into a module-level array. The handlers
/// then held a pointer into a dead frame: the React lane found it as a dangling
/// reference the collector tripped over at exit, and the same program with the
/// closures built *directly* heap-allocates the cell correctly, because there the
/// store's container is the escaping closure itself.
///
/// So the escape happens in a function the caller cannot see, and this is what
/// tells it. Note what is published: the slot whose **contents** escape, not the
/// slot. Marking the parameter escaping would be sound and would send every
/// receiver of a `return this.items` to the heap, which is the allocation this
/// whole pass exists to avoid.
///
/// Recomputed each round of the program fixpoint, because it reads this
/// function's own answer about what escapes -- the same reason
/// `escaping_params` is.
fn leaks_its_fields(func: &Func, escapes: &Escapes) -> FxHashSet<u32> {
    // Everything an op takes as an operand, so a read that goes *only* to the
    // return terminator can be told from one that is handed somewhere.
    let mut handed_on: FxHashSet<ValueId> = FxHashSet::default();
    for block in &func.blocks {
        for value in &block.ops {
            handed_on.extend(super::verify::operands(&func.values[value.0 as usize].kind));
        }
    }
    let mut slots = FxHashSet::default();
    for block in &func.blocks {
        for value in &block.ops {
            let container = match &func.values[value.0 as usize].kind {
                OpKind::FieldGet { object, .. } | OpKind::OpenFieldGet { object, .. } => *object,
                OpKind::ArrayGet { array, .. } => *array,
                OpKind::SharedFieldGet { value, .. } => *value,
                _ => continue,
            };
            // **Returning a field read is not leaking it**, and that is
            // `returned_params`' argument rather than a new one: handing the
            // caller something reachable from what it is already holding does
            // not make it outlive the caller's frame. `reader(o) { return o.f }`
            // is the test that says so, and the first version of this failed it
            // -- it marked slot 0 leaking, so every object anything stored into
            // `a` went to the heap because something, somewhere, read a field of
            // `a` and gave it back.
            //
            // So the read has to be handed to an *op*: stored into a container,
            // passed to a call, erased. A read that only reaches the terminator
            // is excluded.
            //
            // What that leaves, named rather than hidden: if the caller lets the
            // *result* of such a call escape -- `globalThis.x = reader(a)` -- the
            // contents do escape and nothing here says so. It is the same
            // if-the-result-escapes edge `returned_params` publishes for a
            // returned parameter, one level in, and it is a **pre-existing**
            // hole rather than one this introduces: before this function, a
            // field read's obligation was not published at all.
            // A read whose own contents leave leaks this slot's too, one level
            // further in: `f(p) { g(p.inner) }` with `g` keeping a field of what
            // it is given. Publishing the slot over-approximates by a level --
            // the caller escapes everything in `p` -- and that is the safe side.
            if (escapes.escapes(*value) && handed_on.contains(value))
                || escapes.contents_leave.contains(value)
            {
                slots.extend(params_under(func, container));
            }
        }
    }
    // **Forwarding is not reading, and it leaks the same.** `forward(b) {
    // keepInner(b) }` reads no field of `b`, so the rule above published
    // nothing, and `forward`'s callers confined what they put in `b` -- while
    // `keepInner` kept `b.inner` in a module-level array. The obligation this
    // frame took on at the call is the caller's too when what it handed over
    // was a parameter.
    for value in &escapes.contents_leave {
        slots.extend(params_under(func, *value));
    }
    slots
}

/// The parameter slots a value is, through the views that keep a reference's
/// identity -- an erasure, an unerasure, a join. A field read of `unerase(p)`
/// reads `p`'s fields, which is what every `erased_call` entry does.
fn params_under(func: &Func, value: ValueId) -> impl Iterator<Item = u32> + '_ {
    super::carried_values(func, value).filter_map(|at| match func.values[at.0 as usize].kind {
        OpKind::Param(slot) => Some(slot),
        _ => None,
    })
}

/// Which parameter slots a function returns.
///
/// Returning a parameter hands the caller back something it is already holding.
/// It does not make the object outlive the *caller's* frame, which is the only
/// thing "escapes" means -- and marking the slot escaping said it did, so every
/// argument to `pick(a, b, first)` went to the heap. That was all thirty four
/// allocations of `param-returned`.
///
/// The obligation does not vanish, it moves: the caller's *result* is one of its
/// arguments, so if the result escapes the argument does. That is an edge in the
/// same fixpoint the stores use, and it is stated where the alias is.
fn returned_params(func: &Func) -> FxHashSet<u32> {
    let mut slots = FxHashSet::default();
    for block in &func.blocks {
        if let Terminator::Return(Some(value)) = block.terminator
            && let OpKind::Param(slot) = func.values[value.0 as usize].kind
        {
            slots.insert(slot);
        }
    }
    slots
}

/// Analyze every function, letting the answer cross between them.
#[must_use]
pub fn analyze_program(program: &Program) -> Vec<Escapes> {
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    // Knowing what a dispatch can reach is what keeps a closure in the frame.
    // Treating it as opaque -- which is what an external call is -- would mean
    // every closure ever passed anywhere is heap-allocated, and
    // `arr.map(x => x * 2)` would pay an allocation and a reference count for a
    // function whose whole life is one call.
    let in_slot = program.slot_targets();
    let cycles = program.cycles();
    let arity: Vec<usize> = program.funcs.iter().map(|func| func.params.len()).collect();
    let handed_back: Vec<FxHashSet<u32>> = program.funcs.iter().map(returned_params).collect();
    let put_into: Vec<Vec<(u32, u32)>> = program.funcs.iter().map(stores_into).collect();

    // Every parameter starts held, and is released to `escapes` by evidence.
    let mut escaping_params: Vec<FxHashSet<u32>> =
        program.funcs.iter().map(|_| FxHashSet::default()).collect();
    // And every parameter starts with its contents held, for the same reason and
    // in the same direction. See `leaks_its_fields`.
    let mut leaking: Vec<FxHashSet<u32>> =
        program.funcs.iter().map(|_| FxHashSet::default()).collect();
    let mut results: Vec<Escapes> = Vec::new();

    for _ in 0..ROUND_CAP {
        results = program
            .funcs
            .iter()
            .map(|func| {
                analyze(
                    func,
                    &Summaries {
                        cycles: &cycles,
                        by_name: &by_name,
                        in_slot: &in_slot,
                        arity: &arity,
                        escaping_params: &escaping_params,
                        handed_back: &handed_back,
                        put_into: &put_into,
                        leaking: &leaking,
                    },
                )
            })
            .collect();

        let mut changed = false;
        for (index, func) in program.funcs.iter().enumerate() {
            for (slot, parameter) in func
                .parameter_values()
                .unwrap_or_default()
                .into_iter()
                .enumerate()
                .filter_map(|(slot, parameter)| parameter.map(|parameter| (slot, parameter)))
            {
                let Ok(slot) = u32::try_from(slot) else {
                    continue;
                };
                if results[index].escapes(parameter) && escaping_params[index].insert(slot) {
                    changed = true;
                }
            }
            // Monotone in the same direction: a slot whose contents are shown to
            // leave never goes back to held, so the least fixpoint is safe to
            // read only once it has converged.
            for slot in leaks_its_fields(func, &results[index]) {
                if leaking[index].insert(slot) {
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    results
}

/// Mark a value as escaped, and whatever it carries.
///
/// An erased value *is* its payload as far as reachability goes. `Erase` puts a
/// pointer into a tagged slot, so storing the slot anywhere makes the pointer
/// reachable from there — and marking only the erasure left the payload looking
/// frame-local, which is a pointer into a dead frame wherever the slot outlives
/// the function.
///
/// The chain rather than one step, because guessing that the lowering never
/// emits an erasure of an erasure costs correctness and following it costs
/// nothing.
///
/// # Every site, and why
///
/// This function existed and four places did not call it, marking the value
/// with a bare `insert` instead. One of them was `Return`, and it produced this
/// for a `Held | null | undefined`:
///
/// ```c
/// v7 = &v7_frame;                                  // placed in the frame
/// v9 = nts_value_of_reference((NtsHeader *)v7, NTS_TAG_OBJECT);
/// v11 = v7->label;
/// nts_release((NtsHeader *)v11);                   // ...so its fields are walked
/// return v9;                                       // ...and the caller gets both
/// ```
///
/// A pointer into a dead frame *and* its one reference field freed before the
/// caller reads it, because the erasure looked like an ordinary value and the
/// object under it looked frame-local. The same function returning a plain
/// `Held | null` was correct: one absence is a pointer, so there is no erasure
/// and nothing to follow.
///
/// So the rule is that no site marks a value escaped by hand. There is one door
/// and this is it.
fn escaped(escapes: &mut Escapes, func: &Func, value: ValueId) {
    escapes.values.extend(super::carried_values(func, value));
}

/// Whether the collector can buffer a container of this type as a cycle
/// candidate -- and therefore whether what goes into it can live in a frame.
///
/// `nts_release` on a *buffered* object whose count reaches zero does not free
/// it. The candidate buffer is holding a pointer, so freeing there would leave
/// that pointer dangling, and collection frees it later -- from `nts_destroy`
/// at exit if nothing collects first.
///
/// That defers the container's death past the frame the release happened in. A
/// frame-placed object stored inside it is dead stack by the time the collector
/// walks the container looking for cycles. So being bufferable is a way of
/// outliving a frame, and it is one reachability cannot see: the container
/// really does die with the frame as far as any program-visible reference
/// goes, and it is the collector's own bookkeeping that keeps it.
///
/// # Why only an array
///
/// Being *buffered* takes being *released*, and only a heap allocation is.
/// `place_allocations` frames every `ObjectNew` that does not escape, and a
/// frame allocation carries `NTS_IMMORTAL`, so its release returns immediately
/// and it is never offered to the collector. An object that does escape takes
/// what it holds with it through the fixpoint below. Either way the question
/// does not arise for an object.
///
/// An array is never frame-placed -- `place_allocations` frames an `ObjectNew`
/// and a string-returning `Call`, and nothing else -- so it is on the heap, it
/// is released, and a release above zero asks the collector.
///
/// Answering `true` for an object as well was the first version of this, and
/// `tooling/memory/cases/cycle` refuted it in one line: two objects that point
/// at each other, both in the frame, both immortal, neither ever buffered --
/// and eighteen heap allocations appeared where the case says zero.
///
/// The answer has to match the descriptor the backend emits or it is a guess.
/// An array of references gets `nts_desc_ref`, whose `cyclic` is 1, unless
/// [`super::Cycles::array`] proves its elements cannot lead back to it, when it
/// gets `nts_desc_ref_acyclic` and is never buffered -- the question asked here,
/// of the same `Cycles`. An array of scalars gets a descriptor with no
/// reference fields, which the collector never asks about.
fn buffers(ty: &HirType, of: &Summaries<'_>) -> bool {
    matches!(
        ty,
        HirType::Managed(ManagedType::Array(element))
            if element.may_hold_a_reference() && of.cycles.array(element)
    )
}

/// One function, given what each callee does with its parameters.
/// What the rest of the program has been shown to do with what it is handed.
///
/// One struct because these travel together and are read together: four
/// per-function summaries, each a *least* fixpoint the caller must not read
/// before it converges, plus the two indexes that say which function a callee
/// names. Passing them one at a time is what took `analyze` past clippy's
/// argument limit, and the limit was right -- a reader of the call site could
/// not tell which slice meant what.
struct Summaries<'a> {
    /// Which of the program's arrays can be in a cycle: [`buffers`] has to give
    /// the answer the backend's descriptor gives.
    cycles: &'a super::Cycles,
    /// Which function each name is.
    by_name: &'a FxHashMap<&'a str, usize>,
    /// Which functions a dispatch slot can reach.
    in_slot: &'a FxHashMap<u32, Vec<usize>>,
    arity: &'a [usize],
    /// Parameter slots the callee lets escape. See `analyze_program`.
    escaping_params: &'a [FxHashSet<u32>],
    /// Parameter slots the callee returns. See [`returned_params`].
    handed_back: &'a [FxHashSet<u32>],
    /// `(what, into)` slot pairs the callee stores. See [`stores_into`].
    put_into: &'a [Vec<(u32, u32)>],
    /// Parameter slots whose *contents* the callee lets escape. See
    /// [`leaks_its_fields`].
    leaking: &'a [FxHashSet<u32>],
}

// One walk over every operation, each arm a different way a value escapes;
// splitting it would scatter the state the arms share (as in `rc::insert_into`).
#[allow(clippy::too_many_lines)]
fn analyze(func: &Func, of: &Summaries<'_>) -> Escapes {
    let mut escapes = Escapes::default();
    // What each store makes reachable, and from where. Deferred rather than
    // decided here, because whether it escapes is a question about the
    // *container*, and the container can be shown to escape further down the
    // function than the store that filled it.
    let mut reachable_from: Vec<(ValueId, ValueId)> = Vec::new();
    // What a call handed straight back: if the result escapes, so does the
    // argument it *is*. See `returned_params`.
    let mut aliased_by: Vec<(ValueId, ValueId)> = Vec::new();
    // What an edge handed to a block parameter: if the parameter escapes, so
    // does the argument it arrived as. See `escape_through`.
    let mut carried: Vec<(ValueId, ValueId)> = Vec::new();
    // Containers handed to a function that reads their fields out and lets what
    // it read escape. What is *in* them escapes; they themselves need not.
    // See `leaks_its_fields`.
    let mut contents_leave: FxHashSet<ValueId> = FxHashSet::default();
    // Which allocations can run more than once with an earlier result still
    // reachable. See `repeats`.
    let repeated = repeats(func);
    let live = liveness::analyze(func);

    for block in &func.blocks {
        for value in &block.ops {
            match &func.values[value.0 as usize].kind {
                // Into a container, which is written through rather than
                // handed anywhere: what goes in is reachable from wherever the
                // container is -- and *no further*. If the container stays in
                // this frame, so does what went into it.
                //
                // This used to escape the stored value outright, which is safe
                // and costs a heap allocation for every cell a non-escaping
                // closure holds. The reachability question is answered below,
                // once it is known what the containers do.
                OpKind::FieldSet {
                    object: container,
                    value: stored,
                    ..
                }
                | OpKind::ArraySet {
                    array: container,
                    value: stored,
                    ..
                } => {
                    // Only an allocation *this function made* can confine what
                    // goes into it. A parameter is already reachable by the
                    // caller, so `a.field = b` inside `keeper(a, b)` puts `b`
                    // somewhere the caller can see it however local `a` looks
                    // from in here -- and the same goes for a call's result, a
                    // block parameter and anything read back out of a field.
                    //
                    // And only an allocation that runs *once* can be confined
                    // at all when something keeps it. A frame allocation is one
                    // slot; a loop that fills a container with a fresh object
                    // each round needs one per round. Reachability said yes to
                    // this and lifetime says no:
                    //
                    // ```ts
                    // const balls: Ball[] = new Array(100);
                    // for (let i = 0; i < 100; i += 1) {
                    //   balls[i] = new Ball(random);   // one slot, 100 objects
                    // }
                    // ```
                    //
                    // Every element pointed at the same frame slot and read
                    // back the last ball. `awfy-bounce` computed 1117 where
                    // node computes 1331, which is how it was found -- the
                    // benchmark checks its own answer, and nothing else here
                    // had asked a program that stores in a loop.
                    //
                    // What fails is one slot holding many objects, and that
                    // needs the *container* to be made once while the value is
                    // made many times. When both are made per iteration there
                    // is no reuse to get wrong: a fresh closure holding a fresh
                    // cell is two slots reused in lockstep, iteration k's
                    // container holds iteration k's value, and the pair dies
                    // together. Refusing that case sent every object a loop
                    // puts inside another one to the heap.
                    //
                    // The container's own escape is still decided on its own
                    // evidence, and the fixpoint below carries it to whatever
                    // it holds -- so a container that does outlive the loop
                    // takes the value with it.
                    let confinable = matches!(
                        func.values[container.0 as usize].kind,
                        OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
                    ) && (!repeated.contains(stored)
                        || repeated.contains(container))
                        && !buffers(&func.values[container.0 as usize].ty, of);
                    // A parameter stored into a parameter's field is published
                    // rather than escaped: see `stores_into`. The caller knows
                    // whether the container outlives anything and this does not.
                    let deferred_to_caller =
                        matches!(func.values[container.0 as usize].kind, OpKind::Param(_))
                            && matches!(func.values[stored.0 as usize].kind, OpKind::Param(_));
                    if confinable {
                        reachable_from.push((*container, *stored));
                    } else if !deferred_to_caller {
                        escaped(&mut escapes, func, *stored);
                    }
                }
                // A global is the same statement with the strongest possible
                // container -- one that outlives every function -- so there is
                // no question to defer.
                OpKind::GlobalSet { value: stored, .. } => {
                    escaped(&mut escapes, func, *stored);
                }
                OpKind::Call { callee, args, .. } => {
                    let Some(targets) = bodies_reached(callee, of.by_name, of.in_slot) else {
                        gone_into_the_unknown(&mut escapes, func, callee, args);
                        continue;
                    };
                    escape_into(
                        &mut escapes,
                        func,
                        args,
                        targets,
                        of.arity,
                        of.escaping_params,
                    );
                    let one = matches!(callee, Callee::Direct(_));
                    for target in targets {
                        for slot in &of.leaking[*target] {
                            if let Some(argument) = args.get(*slot as usize) {
                                contents_leave.extend(super::carried_values(func, *argument));
                            }
                        }
                        for slot in &of.handed_back[*target] {
                            if let Some(argument) = args.get(*slot as usize) {
                                aliased_by.push((*value, *argument));
                            }
                        }
                        put_where_it_went(
                            &mut escapes,
                            func,
                            of,
                            &repeated,
                            args,
                            &of.put_into[*target],
                            one,
                            &mut reachable_from,
                        );
                    }
                }
                // A suspension hands the frame to the runtime, which stores it
                // in a promise's reaction list and calls back into it after
                // this function has returned. That is the *definition* of
                // escaping, and it is the one object in the program that must
                // not be on the C stack -- outliving its caller is the entire
                // reason it exists.
                //
                // It reached this match's catch-all when the operation was
                // added, and the emitted C put the frame in a `NtsObj_..._frame`
                // local. Nothing failed loudly: the promise stayed pending,
                // because the resumption was writing through a dangling
                // pointer.
                //
                // **And a subscribed reaction is a frame by another name**: the
                // runtime keeps it in the promise's reaction list and calls it after
                // this function has returned. It reached the catch-all below when
                // the operation was added, exactly as `Suspend` once did, and the
                // first `.then` put its reaction -- and the handler stored in it --
                // in the C stack frame, which segfaulted when the microtask ran.
                OpKind::Suspend {
                    promise,
                    frame: handed,
                    ..
                }
                | OpKind::PromiseSubscribe {
                    promise,
                    reaction: handed,
                    ..
                } => {
                    escaped(&mut escapes, func, *promise);
                    escaped(&mut escapes, func, *handed);
                }
                _ => {}
            }
        }

        escape_through(
            &mut escapes,
            func,
            &repeated,
            &live,
            &mut carried,
            &block.terminator,
        );
    }

    // Now the stores, once every other reason to escape is known.
    //
    // A value stored into a container is reachable from that container, so it
    // escapes exactly when the container does. To a fixpoint, because
    // containers nest -- a cell inside a closure inside an array -- and because
    // a container can be shown to escape below the store that filled it.
    //
    // Monotone and bounded: the set only grows, and it is bounded by the values
    // in the function, so this terminates without a round cap.
    loop {
        let before = escapes.values.len();
        for (container, stored) in &reachable_from {
            if escapes.escapes(*container) || contents_leave.contains(container) {
                escaped(&mut escapes, func, *stored);
            }
        }
        for (result, argument) in &aliased_by {
            if escapes.escapes(*result) {
                escaped(&mut escapes, func, *argument);
            }
        }
        for (param, argument) in &carried {
            if escapes.escapes(*param) {
                escaped(&mut escapes, func, *argument);
            }
        }
        if escapes.values.len() == before {
            break;
        }
    }
    escapes.contents_leave = contents_leave;
    escapes
}

/// What leaving a block does to what it carries.
///
/// A value handed to a block parameter has not gone anywhere: it is still in
/// this frame, under the name the successor knows it by. So it escapes exactly
/// when that parameter does, which is another edge in the fixpoint below rather
/// than a reason to give up.
///
/// This used to mark every argument of every edge as escaped -- the same blind
/// spot `crossing_borrows` had, and its comment said so. It cost `total(head)`
/// its parameter: `at = head` hands the list to a loop variable, so every list
/// ever walked was a heap list, and both heads of `shared-tail` with it.
///
/// # The one thing an edge does have to refuse
///
/// A frame allocation is one slot. An allocation made *inside a loop* is that
/// slot reused, and carrying it on an edge is what brings the previous result
/// back to life -- iteration k's object read through a name that now points at
/// iteration k+1's. Nothing else here refuses it: `repeats` is consulted for
/// stores, and `place_allocations` asks only whether the value escapes. So
/// the edge is where it has to be said.
///
/// `Return` is the real thing: the reference is the caller's now -- unless it
/// is a parameter, which the caller was holding before the call. See
/// [`returned_params`].
fn escape_through(
    escapes: &mut Escapes,
    func: &Func,
    repeated: &FxHashSet<ValueId>,
    live: &liveness::Liveness,
    carried: &mut Vec<(ValueId, ValueId)>,
    terminator: &Terminator,
) {
    match terminator {
        Terminator::Return(Some(value)) => {
            if !matches!(func.values[value.0 as usize].kind, OpKind::Param(_)) {
                escaped(escapes, func, *value);
            }
        }
        Terminator::Jump { target, args } => {
            hand_on(escapes, func, repeated, live, carried, *target, args);
        }
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            hand_on(
                escapes,
                func,
                repeated,
                live,
                carried,
                *then_target,
                then_args,
            );
            hand_on(
                escapes,
                func,
                repeated,
                live,
                carried,
                *else_target,
                else_args,
            );
        }
        Terminator::Return(None) | Terminator::Unreachable | Terminator::FellThrough => {}
    }
}

/// One edge: pair each argument with the parameter that receives it.
/// Whether a parameter is still being read where the value it receives is made.
///
/// The allocation is one slot in the frame, written every time its operation
/// runs. That is correct exactly while no earlier result is still wanted -- so
/// the question is whether the parameter receiving it is live at the block that
/// makes it.
///
/// Following where the parameter goes next is not optional. A loop carries a
/// value through the latch's parameter into the header's, and the latch's is
/// dead the instant it is handed on: asking only about the one the edge names
/// said "not live" for `sumChain`, put a list node in one frame slot, and every
/// link pointed at itself. The walk that followed never ended.
fn still_live_where_it_is_made(
    func: &Func,
    live: &liveness::Liveness,
    made: ValueId,
    param: ValueId,
) -> bool {
    let Some(at) = func
        .blocks
        .iter()
        .position(|block| block.ops.contains(&made))
    else {
        return true;
    };
    let block = BlockId(u32::try_from(at).unwrap_or(u32::MAX));
    let mut seen = FxHashSet::default();
    let mut front = vec![param];
    while let Some(one) = front.pop() {
        if !seen.insert(one) {
            continue;
        }
        if live.live_in(block).contains(&one) || live.live_out(block).contains(&one) {
            return true;
        }
        for source in &func.blocks {
            let edges: Vec<(BlockId, &Vec<ValueId>)> = match &source.terminator {
                Terminator::Jump { target, args } => vec![(*target, args)],
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => vec![(*then_target, then_args), (*else_target, else_args)],
                _ => Vec::new(),
            };
            for (target, args) in edges {
                for (slot, argument) in args.iter().enumerate() {
                    if *argument != one {
                        continue;
                    }
                    if let Some(onward) = func
                        .blocks
                        .get(target.0 as usize)
                        .and_then(|block| block.params.get(slot))
                    {
                        front.push(*onward);
                    }
                }
            }
        }
    }
    false
}

fn hand_on(
    escapes: &mut Escapes,
    func: &Func,
    repeated: &FxHashSet<ValueId>,
    live: &liveness::Liveness,
    carried: &mut Vec<(ValueId, ValueId)>,
    target: BlockId,
    args: &[ValueId],
) {
    let params = func
        .blocks
        .get(target.0 as usize)
        .map(|block| block.params.as_slice())
        .unwrap_or_default();
    for (slot, argument) in args.iter().enumerate() {
        let made_here = matches!(
            func.values[argument.0 as usize].kind,
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
        );
        // "One slot, two live results" is a statement about *liveness*, and it
        // used to be tested by repetition alone: any allocation from inside a
        // loop, handed to any block parameter, escaped.
        //
        // Most of them are handed forward within the iteration that made them.
        // A factory merged into its caller returns through a continuation --
        // `const got = maybe(i)` is a parameter receiving either the object or
        // a null -- and that parameter is dead before the loop comes round and
        // the next one is made. One slot is exactly right for it.
        //
        // It is two live results only when the parameter is still live where
        // the allocation happens, which is what a value carried on a *back*
        // edge is: `aCellPerIteration` holds last round's cell across the whole
        // body, so the slot would be written while the previous result is still
        // being read.
        let reused = made_here
            && repeated.contains(argument)
            && params
                .get(slot)
                .is_some_and(|param| still_live_where_it_is_made(func, live, *argument, *param));
        match params.get(slot) {
            Some(_) if reused => {
                escaped(escapes, func, *argument);
            }
            Some(param) => carried.push((*param, *argument)),
            // An argument with no parameter to land in is one this does not
            // model, and what is not modelled is assumed to escape.
            None => {
                escaped(escapes, func, *argument);
            }
        }
    }
}

/// Mark the arguments that any of a call's possible targets lets escape.
/// What a call this analysis cannot follow does to its arguments.
///
/// Everything, by default: a body that is not here could store any of them
/// anywhere. Unless it is one of ours -- the helpers in `runtime/c` are read,
/// and `runtime::keeps` says which slots each may let outlive the call.
///
/// `out += String.fromCharCode(c)` is why that list exists. The one-unit string
/// on the right dies on the next line and could sit in the frame, and nothing
/// could put it there while handing it to `nts_str_append` counted as losing
/// it.
fn gone_into_the_unknown(escapes: &mut Escapes, func: &Func, callee: &Callee, args: &[ValueId]) {
    // Which argument slots a call this analysis cannot see into may keep. `None`
    // is *unknown*, and unknown means all of them -- the distinction between
    // "nothing was proved" and "nothing escapes" is the whole content of this
    // function, and collapsing the two is how an optimizer gets an optimistic
    // answer nobody established.
    //
    // Two foreign populations answer here and they answer from different
    // evidence. A runtime helper or a bound Java member answers from
    // `runtime::keeps`, keyed by name. A `declare`d C function answers from its
    // own declaration: `@ntsNoEscape` is validated where the signature is built,
    // and it is the same fact `native_storage` already trusts to decide that a
    // local address may be passed at all. Reading it here rather than assuming
    // the worst is not a new claim, it is the claim already made, used twice.
    //
    // Deliberately not a name table for the native side. A prefix list would be
    // a second derivation of a fact the declaration already states, and the two
    // would disagree the first time someone renamed a binding.
    match kept_slots(callee) {
        Some(slots) => {
            for slot in slots {
                if let Some(argument) = args.get(slot) {
                    escaped(escapes, func, *argument);
                }
            }
        }
        None => {
            for argument in args {
                escaped(escapes, func, *argument);
            }
        }
    }
}

/// Which argument slots a foreign call may keep, or `None` for "all of them".
///
/// Separated from its one caller so the decision can be asked about directly.
/// Its effect on placement is not observable -- `@ntsNoEscape` is accepted only
/// on native pointer parameters, and those never reach `place_allocations`, so
/// the two populations are disjoint by construction and no reachable allocation
/// moves because of this. That is exactly why it needs a test of its own: a
/// fact with no observable consequence is a fact nothing else will notice
/// losing.
pub(crate) fn kept_slots(callee: &Callee) -> Option<Vec<usize>> {
    match callee {
        Callee::External(name) => super::runtime::keeps(name).map(<[usize]>::to_vec),
        Callee::Native(target) => Some(
            (0..target.parameters.len())
                .filter(|slot| {
                    !matches!(
                        target.retention.get(*slot),
                        Some(super::native::Retention::NotRetained)
                    )
                })
                .collect(),
        ),
        _ => None,
    }
}

/// The bodies one call can reach, or `None` for "anything at all".
///
/// A dispatch reaches one of several and which is decided by a receiver this
/// cannot see, so an argument escapes if *any* of them lets it -- a union
/// rather than a guess, because the table is complete. A body that is not in
/// this program is the case with no answer.
fn bodies_reached<'a>(
    callee: &Callee,
    by_name: &'a FxHashMap<&str, usize>,
    in_slot: &'a FxHashMap<u32, Vec<usize>>,
) -> Option<&'a [usize]> {
    match callee {
        Callee::External(_) | Callee::Native(_) => None,
        Callee::Direct(name) => by_name.get(name.as_str()).map(std::slice::from_ref),
        Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
            in_slot.get(slot).map(Vec::as_slice)
        }
    }
}

/// The caller's half of a store into a parameter.
///
/// `stores_into` says the callee put one parameter inside another and left the
/// lifetime question open. Here is where it is answered, and the answer is the
/// *same store*, asked one frame out -- so it faces every test the store in
/// this function faces, and all three of them are load-bearing:
///
/// Is the container something this function made? A parameter is not. It came
/// from a caller and outlives this frame, so what goes into it does too --
/// `push(list, new Node())` in a function that was handed the list is a fresh
/// node in a frame and a list pointing into it after the frame is gone. That is
/// what `escape` refused to do by escaping the argument outright, and leaving
/// it out here was a segmentation fault in `examples/cycles` under LLVM and a
/// program the C backend happened to survive.
///
/// Is it one call reaching one body? A dispatch is decided by a receiver this
/// cannot see, and the containers those bodies store into need not be the same.
///
/// Does what goes in live at least as long as what it goes into? A
/// per-iteration disk pushed onto a pile that outlives the loop does not. The
/// frame has one slot for that allocation and reuses it, so the pile would hold
/// seventeen pointers to the same disk.
// One more than clippy's seven: `of` is what `buffers` asks, and folding it
// into another argument would hide which question each one answers.
#[allow(clippy::too_many_arguments)]
fn put_where_it_went(
    escapes: &mut Escapes,
    func: &Func,
    of: &Summaries<'_>,
    repeated: &FxHashSet<ValueId>,
    args: &[ValueId],
    pairs: &[(u32, u32)],
    one: bool,
    reachable_from: &mut Vec<(ValueId, ValueId)>,
) {
    for (what, into) in pairs {
        let (Some(stored), Some(container)) = (args.get(*what as usize), args.get(*into as usize))
        else {
            continue;
        };
        let ours = matches!(
            func.values[container.0 as usize].kind,
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
        ) && !buffers(&func.values[container.0 as usize].ty, of);
        let outlived = !repeated.contains(stored) || repeated.contains(container);
        if one && ours && outlived {
            reachable_from.push((*container, *stored));
        } else {
            // Which body a dispatch reaches is decided by a receiver this
            // cannot see, and the containers they store into need not be the
            // same one.
            escaped(escapes, func, *stored);
        }
    }
}

fn escape_into(
    escapes: &mut Escapes,
    func: &Func,
    args: &[ValueId],
    targets: &[usize],
    arity: &[usize],
    escaping_params: &[FxHashSet<u32>],
) {
    for (slot, argument) in args.iter().enumerate() {
        let at = u32::try_from(slot).unwrap_or(u32::MAX);
        let escaping = targets.iter().any(|target| {
            // An argument past the end of a target's parameter list is one this
            // does not model, and what is not modelled is assumed to escape.
            slot >= arity[*target] || escaping_params[*target].contains(&at)
        });
        if escaping {
            escaped(escapes, func, *argument);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, Field, HirType, Layout, ManagedType, Op, Param, TypeId};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn object() -> HirType {
        HirType::Managed(ManagedType::Object(TypeId(1)))
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    fn func(name: &str, params: usize, values: Vec<Op>, blocks: Vec<Block>) -> Func {
        Func {
            name: name.to_owned(),
            params: (0..params)
                .map(|index| Param {
                    name: format!("p{index}"),
                    ty: object(),
                    origin: origin(),
                    known: crate::hir::facts::Facts::TOP,
                    written: None,
                    shape: crate::hir::ParamShape::Ordinary,
                })
                .collect(),
            return_type: HirType::Void,
            values,
            blocks,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            written_return: None,
            written_return_elements: Vec::new(),
        }
    }

    /// `reader(o) { return o.f }` — the receiver is read through and handed
    /// nowhere, so it stays in the frame. This is what a getter is.
    #[test]
    fn reading_through_a_reference_does_not_let_it_escape() {
        let values = vec![
            op(OpKind::Param(0), object()),
            op(
                OpKind::FieldGet {
                    object: ValueId(0),
                    field: 0,
                },
                HirType::NUMBER,
            ),
        ];
        let blocks = vec![Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1)],
            terminator: Terminator::Return(Some(ValueId(1))),
        }];
        let program = Program {
            funcs: vec![func("reader", 1, values, blocks)],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        assert!(!escapes[0].escapes(ValueId(0)));
        // The number it returns is not a reference, but the analysis does not
        // ask about types -- what is returned is gone, and that is uniform.
        assert!(escapes[0].escapes(ValueId(1)));
    }

    /// `keeper(box, item) { box.f = item }` — neither parameter escapes *here*.
    ///
    /// This function has no opinion on how long either one lives. What `item`
    /// went into is `box`, and whether that outlives anything is a question
    /// only a caller can answer -- so the pair is published and the caller adds
    /// the edge. Deciding it here sent every constructor argument to the heap,
    /// `this.label = label` being the whole of most constructors.
    #[test]
    fn a_stored_argument_is_the_callers_question() {
        let values = vec![
            op(OpKind::Param(0), object()),
            op(OpKind::Param(1), object()),
            op(
                OpKind::FieldSet {
                    object: ValueId(0),
                    field: 0,
                    value: ValueId(1),
                },
                HirType::Void,
            ),
        ];
        let blocks = vec![Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1), ValueId(2)],
            terminator: Terminator::Return(None),
        }];
        let program = Program {
            funcs: vec![func("keeper", 2, values, blocks)],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        assert!(!escapes[0].escapes(ValueId(0)));
        assert!(!escapes[0].escapes(ValueId(1)));
        // And the fact that replaces it, for the caller to use.
        assert_eq!(stores_into(&program.funcs[0]), vec![(1, 0)]);
    }

    /// The point of the whole module: an allocation passed only to functions
    /// that read it stays in the frame, and the same allocation passed to one
    /// that keeps it does not.
    #[test]
    fn an_allocation_follows_what_its_callees_do_with_it() {
        let mut program = Program {
            funcs: Vec::new(),
            layouts: vec![Layout {
                types: vec![TypeId(1)],
                name: "Point".to_owned(),
                interfaces: Vec::new(),
                fields: vec![Field {
                    name: "f".to_owned(),
                    ty: HirType::NUMBER,
                    readonly: false,
                    declared_by: None,
                    written: None,
                }],
                methods: Vec::new(),
                base: None,
            }],
            globals: Vec::new(),
            ..Program::default()
        };

        // `reader(o) { return o.f }`
        program.funcs.push(func(
            "reader",
            1,
            vec![
                op(OpKind::Param(0), object()),
                op(
                    OpKind::FieldGet {
                        object: ValueId(0),
                        field: 0,
                    },
                    HirType::NUMBER,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1)],
                terminator: Terminator::Return(Some(ValueId(1))),
            }],
        ));

        // `keeper(box, item) { box.f = item }`
        program.funcs.push(func(
            "keeper",
            2,
            vec![
                op(OpKind::Param(0), object()),
                op(OpKind::Param(1), object()),
                op(
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));

        // `caller() { const a = new P(); reader(a); const b = new P(); keeper(a, b) }`
        program.funcs.push(func(
            "caller",
            0,
            vec![
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("reader".to_owned()),
                        args: vec![ValueId(0)],
                        frame: None,
                    },
                    HirType::NUMBER,
                ),
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("keeper".to_owned()),
                        args: vec![ValueId(0), ValueId(2)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                terminator: Terminator::Return(None),
            }],
        ));

        let escapes = analyze_program(&program);
        let caller = &escapes[2];
        // `a` is only ever read through, including inside `keeper`.
        assert!(caller.is_frame_local(ValueId(0)));
        // And `b` is inside `a`, which is a frame that outlives both of them.
        // It outlives the *call* that put it there, which is what this used to
        // ask and is not the question: nothing here outlives the frame.
        assert!(caller.is_frame_local(ValueId(2)));
        assert!(!caller.escapes(ValueId(2)));
    }

    /// The same store, one iteration at a time.
    ///
    /// `while (true) { keeper(a, new P()) }` — a fresh object every time round,
    /// all of them going into one container. A frame has one slot for the
    /// allocation, reused, so the container would end up holding the last one
    /// and pointing at it from every field it ever wrote. `guarded-push` is
    /// this exactly: `pile.push(new Disk(i))`, and it built a pile of one disk
    /// seventeen times until the guard read a size that was not there.
    #[test]
    fn a_fresh_one_each_time_round_does_not_go_in_a_frame() {
        let mut program = Program {
            funcs: Vec::new(),
            layouts: vec![Layout {
                types: vec![TypeId(1)],
                name: "Point".to_owned(),
                interfaces: Vec::new(),
                fields: vec![Field {
                    name: "f".to_owned(),
                    ty: HirType::NUMBER,
                    readonly: false,
                    declared_by: None,
                    written: None,
                }],
                methods: Vec::new(),
                base: None,
            }],
            globals: Vec::new(),
            ..Program::default()
        };
        program.funcs.push(func(
            "keeper",
            2,
            vec![
                op(OpKind::Param(0), object()),
                op(OpKind::Param(1), object()),
                op(
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));
        program.funcs.push(func(
            "caller",
            0,
            vec![
                op(OpKind::ObjectNew { frame: false }, object()),
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("keeper".to_owned()),
                        args: vec![ValueId(0), ValueId(1)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(1), ValueId(2)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                },
            ],
        ));

        let escapes = analyze_program(&program);
        let caller = &escapes[1];
        // The container is made once and holds everything, so it can stay.
        assert!(caller.is_frame_local(ValueId(0)));
        // What goes into it is made seventeen times and must not.
        assert!(caller.escapes(ValueId(1)));
    }

    /// The container came from somewhere else, so what goes into it does too.
    ///
    /// `build(list) { push(list, new P()) }` — `list` is a parameter, which
    /// means a caller made it and a caller still has it. A node put inside it
    /// outlives this frame no matter what this frame does, and putting it in
    /// the frame anyway was a list pointing at dead stack the moment `build`
    /// returned.
    #[test]
    fn what_goes_into_a_parameter_is_gone() {
        let mut program = Program {
            funcs: Vec::new(),
            layouts: vec![Layout {
                types: vec![TypeId(1)],
                name: "Point".to_owned(),
                interfaces: Vec::new(),
                fields: vec![Field {
                    name: "f".to_owned(),
                    ty: HirType::NUMBER,
                    readonly: false,
                    declared_by: None,
                    written: None,
                }],
                methods: Vec::new(),
                base: None,
            }],
            globals: Vec::new(),
            ..Program::default()
        };
        program.funcs.push(func(
            "keeper",
            2,
            vec![
                op(OpKind::Param(0), object()),
                op(OpKind::Param(1), object()),
                op(
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));
        program.funcs.push(func(
            "build",
            1,
            vec![
                op(OpKind::Param(0), object()),
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("keeper".to_owned()),
                        args: vec![ValueId(0), ValueId(1)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));

        let escapes = analyze_program(&program);
        assert!(escapes[1].escapes(ValueId(1)));
        assert!(!escapes[1].is_frame_local(ValueId(1)));
    }

    /// A global outlives every function, so what it holds cannot be in a frame.
    ///
    /// And it is reached *through* an erasure, which is the half that made this
    /// silent: marking the erasure escaped left the object it carries looking
    /// frame-local, so `{ tag: n }` assigned to a module-scope `unknown` was
    /// placed in the caller's frame and the global pointed at dead stack from
    /// the moment the function returned. The emitted C said `NtsObj_..._frame`
    /// and nothing failed.
    #[test]
    fn what_a_global_holds_cannot_live_in_a_frame() {
        let mut program = Program::default();
        program.funcs.push(func(
            "stash",
            0,
            vec![
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Erase {
                        value: ValueId(0),
                        absent: super::super::Absent::Impossible,
                    },
                    HirType::Erased,
                ),
                op(
                    OpKind::GlobalSet {
                        global: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));

        let escapes = analyze_program(&program);
        let stash = &escapes[0];
        assert!(
            stash.escapes(ValueId(1)),
            "the erasure is stored in a global"
        );
        assert!(stash.escapes(ValueId(0)), "and so is the object it carries");
        assert!(!stash.is_frame_local(ValueId(0)));
    }

    /// The other direction of the same box: what an `Unerase` produces is the
    /// pointer that was erased, so keeping it keeps the parameter it came from.
    ///
    /// This is the shape of every function value's `erased_call` entry -- it
    /// unerases its argument and hands it to the written body -- and only
    /// `Erase` was followed. `entry`'s parameter looked held, so `caller` put
    /// the object it erased and passed in its own frame, and the global pointed
    /// at dead stack. The GTK corpus's `Workbench` was that object.
    #[test]
    fn what_an_unerasure_keeps_its_parameter_keeps() {
        let mut program = Program::default();
        // `entry(p) { stash = unerase(p) }`
        program.funcs.push(func(
            "entry",
            1,
            vec![
                op(OpKind::Param(0), HirType::Erased),
                op(OpKind::Unerase { value: ValueId(0) }, object()),
                op(
                    OpKind::GlobalSet {
                        global: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));
        // `caller() { entry(erase(new P())) }`
        program.funcs.push(func(
            "caller",
            0,
            vec![
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Erase {
                        value: ValueId(0),
                        absent: super::super::Absent::Impossible,
                    },
                    HirType::Erased,
                ),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("entry".to_owned()),
                        args: vec![ValueId(1)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));

        let escapes = analyze_program(&program);
        assert!(
            escapes[0].escapes(ValueId(0)),
            "the parameter is what was stored"
        );
        assert!(
            !escapes[1].is_frame_local(ValueId(0)),
            "so the caller's object is on the heap"
        );
    }

    /// A function that only forwards its parameter takes on the obligation of
    /// the one it forwards to.
    ///
    /// `keeper(p) { stash = p.f }` publishes that slot 0's contents leave.
    /// `forward(p) { keeper(p) }` reads no field, and published nothing, so
    /// `caller` confined the object it put in `o` -- and the global held a
    /// pointer into `caller`'s dead frame.
    #[test]
    fn forwarding_a_parameter_forwards_what_leaves_it() {
        let mut program = Program::default();
        // `keeper(p) { stash = p.f }`
        program.funcs.push(func(
            "keeper",
            1,
            vec![
                op(OpKind::Param(0), object()),
                op(
                    OpKind::FieldGet {
                        object: ValueId(0),
                        field: 0,
                    },
                    object(),
                ),
                op(
                    OpKind::GlobalSet {
                        global: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
        ));
        // `forward(p) { keeper(p) }`
        program.funcs.push(func(
            "forward",
            1,
            vec![
                op(OpKind::Param(0), object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("keeper".to_owned()),
                        args: vec![ValueId(0)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1)],
                terminator: Terminator::Return(None),
            }],
        ));
        // `caller() { const o = new P(); o.f = new P(); forward(o) }`
        program.funcs.push(func(
            "caller",
            0,
            vec![
                op(OpKind::ObjectNew { frame: false }, object()),
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field: 0,
                        value: ValueId(1),
                    },
                    HirType::Void,
                ),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("forward".to_owned()),
                        args: vec![ValueId(0)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                terminator: Terminator::Return(None),
            }],
        ));

        let escapes = analyze_program(&program);
        let caller = &escapes[2];
        assert!(
            !caller.is_frame_local(ValueId(1)),
            "what `keeper` keeps is on the heap"
        );
        // And the container is not: `keeper` reads through it and keeps nothing
        // of it but its contents, which is what `leaks_its_fields` is for.
        assert!(caller.is_frame_local(ValueId(0)));
    }

    /// An allocation nothing does anything with stays in the frame, which is
    /// the base case the rest of the module narrows from.
    #[test]
    fn an_allocation_that_goes_nowhere_stays_in_the_frame() {
        let program = Program {
            funcs: vec![func(
                "make",
                0,
                vec![op(OpKind::ObjectNew { frame: false }, object())],
                vec![Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0)],
                    terminator: Terminator::Return(None),
                }],
            )],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        assert!(escapes[0].is_frame_local(ValueId(0)));
    }

    /// What a local container holds is reachable from that container and no
    /// further, so both stay in the frame. This is the closure-and-cell case:
    /// before it, every cell a non-escaping closure held was a heap
    /// allocation.
    #[test]
    fn what_a_frame_local_container_holds_stays_in_the_frame() {
        let program = Program {
            funcs: vec![func(
                "make",
                0,
                vec![
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(
                        OpKind::FieldSet {
                            object: ValueId(0),
                            field: 0,
                            value: ValueId(1),
                        },
                        HirType::Void,
                    ),
                ],
                vec![Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                    terminator: Terminator::Return(None),
                }],
            )],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        assert!(escapes[0].is_frame_local(ValueId(0)));
        assert!(escapes[0].is_frame_local(ValueId(1)));
    }

    /// ...but not when the collector can *buffer* the container.
    ///
    /// `nts_release` on a buffered object whose count reaches zero does not
    /// free it: the candidate buffer is holding a pointer, so collection frees
    /// it later -- from `nts_destroy` at exit if nothing collects first. That
    /// is the container outliving the frame the release happened in, and a
    /// frame-placed object stored inside it is a pointer into dead stack by the
    /// time the collector walks it looking for cycles.
    ///
    /// An array of references is buffered because every one of them shares a
    /// single descriptor, and that descriptor is conservatively cyclic. An
    /// object is not: one that does not escape is in the frame and immortal,
    /// which is `what_a_frame_local_container_holds_stays_in_the_frame` above.
    ///
    /// The program this came from segfaulted under `NTS_RC_NAIVE` and is now
    /// `tooling/memory/cases/cyclic-array`, which holds the cost still.
    #[test]
    fn what_a_bufferable_container_holds_cannot_stay_in_the_frame() {
        let program = Program {
            funcs: vec![func(
                "make",
                0,
                vec![
                    op(OpKind::ConstFloat(1.0), HirType::NUMBER),
                    op(
                        OpKind::ArrayNew {
                            length: ValueId(0),
                            zeroed: false,
                        },
                        HirType::Managed(ManagedType::Array(Box::new(object()))),
                    ),
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(
                        OpKind::ArraySet {
                            array: ValueId(1),
                            index: ValueId(0),
                            value: ValueId(2),
                            checked: false,
                        },
                        HirType::Void,
                    ),
                ],
                vec![Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                    terminator: Terminator::Return(None),
                }],
            )],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        // The array goes nowhere, and nothing here says otherwise.
        assert!(escapes[0].is_frame_local(ValueId(1)));
        // What it holds cannot stay, though it is reachable from nothing else:
        // the collector can keep the array past this frame.
        assert!(!escapes[0].is_frame_local(ValueId(2)));
    }

    /// ...and when the container leaves, what it holds leaves with it. The
    /// fixpoint is what carries the answer backwards from the `return` to a
    /// store written above it.
    #[test]
    fn what_an_escaping_container_holds_escapes_with_it() {
        let program = Program {
            funcs: vec![func(
                "make",
                0,
                vec![
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(
                        OpKind::FieldSet {
                            object: ValueId(0),
                            field: 0,
                            value: ValueId(1),
                        },
                        HirType::Void,
                    ),
                ],
                vec![Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                    terminator: Terminator::Return(Some(ValueId(0))),
                }],
            )],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let escapes = analyze_program(&program);
        assert!(escapes[0].escapes(ValueId(0)));
        assert!(
            escapes[0].escapes(ValueId(1)),
            "a returned container carries what was stored into it"
        );
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod foreign_contracts {
    use super::{Callee, kept_slots};
    use crate::hir::native::{Convention, Function, Retention, Type};

    fn native(retention: Vec<Retention>) -> Callee {
        Callee::Native(std::sync::Arc::new(Function {
            name: "consume".to_owned(),
            convention: Convention::C,
            parameters: vec![Type::Void, Type::Void],
            result: Type::Void,
            retention,
            variadic: None,
            // This asks about retention, which no module decides.
            declared_at: None,
            roles: vec![crate::hir::native::Role::Plain; 2],
            returns_string: None,
            returns_array: None,
            returns_dictionary: None,
            returns_set: None,
            send: None,
            returns_owned: false,
            consumes: Vec::new(),
            frameworks: Vec::new(),
            libraries: Vec::new(),
            defaults: Vec::new(),
            result_as: None,
            vtable: None,
            hresult: false,
            result_as_number: false,
        }))
    }

    /// Both foreign lanes answer from their own evidence, and `Unknown` is not
    /// "nothing escapes".
    ///
    /// One arm used to answer for `Callee::External` and `Callee::Native`
    /// together by returning `None`, which means *all slots escape* -- correct
    /// for something nothing was known about, and a refusal to read a
    /// declaration that says otherwise.
    ///
    /// **This has no observable effect on placement**, and the test exists
    /// because of that rather than despite it: `@ntsNoEscape` is accepted only
    /// on native pointer parameters, which never reach `place_allocations`, so
    /// the populations are disjoint by construction. Nothing downstream would
    /// notice this fact being lost. Measured before claiming otherwise.
    #[test]
    fn a_declared_contract_is_read_and_unknown_is_not_a_contract() {
        // Every slot escapes: nothing was established about either.
        assert_eq!(
            kept_slots(&native(vec![Retention::Unknown, Retention::Unknown])),
            Some(vec![0, 1])
        );
        // The first is authored not-retained, so only the second is kept.
        assert_eq!(
            kept_slots(&native(vec![Retention::NotRetained, Retention::Unknown])),
            Some(vec![1])
        );
        assert_eq!(
            kept_slots(&native(vec![
                Retention::NotRetained,
                Retention::NotRetained
            ])),
            Some(Vec::new())
        );

        // A callee neither lane describes stays unknown, which is `None` and
        // means all of them -- the distinction this function exists for.
        assert_eq!(kept_slots(&Callee::Direct("whatever".to_owned())), None);
        // And the other foreign lane still answers from its own table rather
        // than from a native declaration, which is what "one arm, two lanes"
        // has to mean: one place, two sources of evidence.
        assert_eq!(
            kept_slots(&Callee::External("nts_unknown_helper".to_owned())),
            None
        );
    }
}
