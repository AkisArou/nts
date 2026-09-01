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
//! - passed along an edge, because a block parameter is a value this analysis
//!   does not follow;
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

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, OpKind, Program, Terminator, ValueId};

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
    let arity: Vec<usize> = program.funcs.iter().map(|func| func.params.len()).collect();

    // Every parameter starts held, and is released to `escapes` by evidence.
    let mut escaping_params: Vec<FxHashSet<u32>> =
        program.funcs.iter().map(|_| FxHashSet::default()).collect();
    let mut results: Vec<Escapes> = Vec::new();

    for _ in 0..ROUND_CAP {
        results = program
            .funcs
            .iter()
            .map(|func| analyze(func, &by_name, &in_slot, &arity, &escaping_params))
            .collect();

        let mut changed = false;
        for (index, func) in program.funcs.iter().enumerate() {
            for slot in 0..u32::try_from(func.params.len()).unwrap_or(0) {
                // Parameter `i` is value `i`, the convention the whole backend
                // shares.
                if results[index].escapes(ValueId(slot)) && escaping_params[index].insert(slot) {
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
fn escaped(escapes: &mut Escapes, func: &Func, value: ValueId) {
    let mut at = value;
    loop {
        escapes.values.insert(at);
        let OpKind::Erase { value: payload } = func.values[at.0 as usize].kind else {
            return;
        };
        if escapes.values.contains(&payload) {
            return;
        }
        at = payload;
    }
}

/// One function, given what each callee does with its parameters.
fn analyze(
    func: &Func,
    by_name: &FxHashMap<&str, usize>,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    arity: &[usize],
    escaping_params: &[FxHashSet<u32>],
) -> Escapes {
    let mut escapes = Escapes::default();
    // What each store makes reachable, and from where. Deferred rather than
    // decided here, because whether it escapes is a question about the
    // *container*, and the container can be shown to escape further down the
    // function than the store that filled it.
    let mut reachable_from: Vec<(ValueId, ValueId)> = Vec::new();
    // Which allocations can run more than once with an earlier result still
    // reachable. See `repeats`.
    let repeated = repeats(func);

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
                    ) && (!repeated.contains(stored) || repeated.contains(container));
                    if confinable {
                        reachable_from.push((*container, *stored));
                    } else {
                        escaped(&mut escapes, func, *stored);
                    }
                }
                // A global is the same statement with the strongest possible
                // container -- one that outlives every function -- so there is
                // no question to defer.
                OpKind::GlobalSet { value: stored, .. } => {
                    escaped(&mut escapes, func, *stored);
                }
                OpKind::Call { callee, args, .. } => match callee {
                    // A body that is not here could do anything with what it is
                    // given.
                    Callee::External(_) => {
                        for argument in args {
                            escaped(&mut escapes, func, *argument);
                        }
                    }
                    Callee::Direct(name) => {
                        let Some(target) = by_name.get(name.as_str()) else {
                            for argument in args {
                                escaped(&mut escapes, func, *argument);
                            }
                            continue;
                        };
                        escape_into(
                            &mut escapes,
                            args,
                            std::slice::from_ref(target),
                            arity,
                            escaping_params,
                        );
                    }
                    // A dispatch reaches one of several bodies, and which is
                    // decided by a receiver this cannot see -- so an argument
                    // escapes if *any* of them lets it. That is a union rather
                    // than a guess, because the table is the complete list.
                    Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
                        let Some(targets) = in_slot.get(slot) else {
                            for argument in args {
                                escaped(&mut escapes, func, *argument);
                            }
                            continue;
                        };
                        escape_into(&mut escapes, args, targets, arity, escaping_params);
                    }
                },
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
                OpKind::Suspend { promise, frame, .. } => {
                    escapes.values.insert(*promise);
                    escapes.values.insert(*frame);
                }
                _ => {}
            }
        }

        // A block parameter is a value this analysis does not follow, so
        // anything handed to one is treated as gone. `Return` is the real thing:
        // the reference is the caller's now.
        match &block.terminator {
            Terminator::Return(Some(value)) => {
                escapes.values.insert(*value);
            }
            Terminator::Jump { args, .. } => escapes.values.extend(args.iter().copied()),
            Terminator::Branch {
                then_args,
                else_args,
                ..
            } => {
                escapes.values.extend(then_args.iter().copied());
                escapes.values.extend(else_args.iter().copied());
            }
            Terminator::Return(None) | Terminator::Unreachable | Terminator::FellThrough => {}
        }
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
            if escapes.escapes(*container) {
                escaped(&mut escapes, func, *stored);
            }
        }
        if escapes.values.len() == before {
            break;
        }
    }
    escapes
}

/// Mark the arguments that any of a call's possible targets lets escape.
fn escape_into(
    escapes: &mut Escapes,
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
            escapes.values.insert(*argument);
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
                })
                .collect(),
            return_type: HirType::Void,
            values,
            blocks,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
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
        };
        let escapes = analyze_program(&program);
        assert!(!escapes[0].escapes(ValueId(0)));
        // The number it returns is not a reference, but the analysis does not
        // ask about types -- what is returned is gone, and that is uniform.
        assert!(escapes[0].escapes(ValueId(1)));
    }

    /// `keeper(box, item) { box.f = item }` — one parameter is written through
    /// and stays; the other is put somewhere that outlives the call and goes.
    /// A caller of this has to know the difference, which is the whole reason
    /// the summary is per parameter rather than per function.
    #[test]
    fn a_stored_argument_escapes_and_the_container_does_not() {
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
        };
        let escapes = analyze_program(&program);
        assert!(!escapes[0].escapes(ValueId(0)));
        assert!(escapes[0].escapes(ValueId(1)));
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
                fields: vec![Field {
                    name: "f".to_owned(),
                    ty: HirType::NUMBER,
                    readonly: false,
                }],
                methods: Vec::new(),
            }],
            globals: Vec::new(),
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
        // `b` is put inside `a`, and outlives the call that put it there.
        assert!(caller.escapes(ValueId(2)));
        assert!(!caller.is_frame_local(ValueId(2)));
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
                op(OpKind::Erase { value: ValueId(0) }, HirType::Erased),
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
        };
        let escapes = analyze_program(&program);
        assert!(escapes[0].is_frame_local(ValueId(0)));
        assert!(escapes[0].is_frame_local(ValueId(1)));
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
        };
        let escapes = analyze_program(&program);
        assert!(escapes[0].escapes(ValueId(0)));
        assert!(
            escapes[0].escapes(ValueId(1)),
            "a returned container carries what was stored into it"
        );
    }
}
