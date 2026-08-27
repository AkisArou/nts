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

    // Which functions a dispatch slot can land on. Exactly the set
    // `hir::reachable` walks: a table entry is a possible target, and there is
    // nothing else a call through the slot can reach.
    //
    // Knowing the set is what keeps a closure in the frame. Treating a dispatch
    // as opaque -- which is what an external call is -- would mean every
    // closure ever passed anywhere is heap-allocated, and `arr.map(x => x * 2)`
    // would pay an allocation and a reference count for a function whose whole
    // life is one call.
    let mut in_slot: FxHashMap<u32, Vec<usize>> = FxHashMap::default();
    for layout in &program.layouts {
        for (slot, method) in layout.methods.iter().enumerate() {
            let Some(target) = method.as_deref().and_then(|name| by_name.get(name)) else {
                continue;
            };
            let entry = in_slot
                .entry(u32::try_from(slot).unwrap_or(u32::MAX))
                .or_default();
            if !entry.contains(target) {
                entry.push(*target);
            }
        }
    }
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

/// One function, given what each callee does with its parameters.
fn analyze(
    func: &Func,
    by_name: &FxHashMap<&str, usize>,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    arity: &[usize],
    escaping_params: &[FxHashSet<u32>],
) -> Escapes {
    let mut escapes = Escapes::default();

    for block in &func.blocks {
        for value in &block.ops {
            match &func.values[value.0 as usize].kind {
                // The container is written through, not handed anywhere; what
                // goes into it is now reachable from wherever the container is.
                OpKind::FieldSet { value: stored, .. } | OpKind::ArraySet { value: stored, .. } => {
                    escapes.values.insert(*stored);
                }
                OpKind::Call { callee, args } => match callee {
                    // A body that is not here could do anything with what it is
                    // given.
                    Callee::External(_) => {
                        escapes.values.extend(args.iter().copied());
                    }
                    Callee::Direct(name) => {
                        let Some(target) = by_name.get(name.as_str()) else {
                            escapes.values.extend(args.iter().copied());
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
                            escapes.values.extend(args.iter().copied());
                            continue;
                        };
                        escape_into(&mut escapes, args, targets, arity, escaping_params);
                    }
                },
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
            Terminator::Return(None) | Terminator::Unreachable => {}
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
                    },
                    HirType::NUMBER,
                ),
                op(OpKind::ObjectNew { frame: false }, object()),
                op(
                    OpKind::Call {
                        callee: Callee::Direct("keeper".to_owned()),
                        args: vec![ValueId(0), ValueId(2)],
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
}
