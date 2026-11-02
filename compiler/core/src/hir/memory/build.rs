use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::super::contents::{Tags, Unknown, ValueFact};
use super::super::{
    BinOp, BlockId, Callee, HirType, ManagedType, OpKind, Program, Terminator, ValueId, cfg, facts,
    reachable, regions, verify,
};
use super::graph::{Graph, Instance, Node, Object, ObjectInfo, Slot};
use super::lifetime::{self, Bound, Exposure};
use super::outcomes;
use super::report::{
    CaptureWrite, Frontier, FunctionSummary, Outcome, Report, RetainedBytes, Retention, Site,
    SlotFact, StoreVersion, Value,
};
use super::summary::Summary;
use super::{Home, Limits, Multiplicity, Reason, SiteId, Storage};

#[derive(Debug, Default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent monotone effect columns, not mutually exclusive states"
)]
struct Effects {
    writes: BTreeSet<String>,
    length: bool,
    suspension: bool,
    reentrant: bool,
    unknown: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Absent, Block, Func, Layout, Op};
    use nts_diagnostics::{Location, SourceId, Span};

    fn origin() -> nts_semantic_schema::Origin {
        nts_semantic_schema::Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn function(name: String, kinds: Vec<OpKind>) -> Func {
        let ops = (0..kinds.len())
            .map(|at| ValueId(u32::try_from(at).expect("test value")))
            .collect();
        Func {
            name,
            params: Vec::new(),
            return_type: HirType::Void,
            written_return: None,
            written_return_elements: Vec::new(),
            validation: None,
            result_absent: Absent::Impossible,
            values: kinds
                .into_iter()
                .map(|kind| Op {
                    kind,
                    ty: HirType::Void,
                    origin: origin(),
                })
                .collect(),
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(None),
            }],
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
        }
    }

    fn context(effects: Effects) -> Context {
        Context {
            function: 0,
            key: String::new(),
            parent: None,
            call: None,
            ancestors: Vec::new(),
            values: BTreeMap::new(),
            result: 0,
            fallback: false,
            repeated: false,
            effects,
        }
    }

    #[test]
    fn many_empty_callees_do_not_snapshot_the_parents_large_write_set() {
        // A compile-time guard on the production type makes restoring either
        // whole-Effects snapshot fail, even if its copying were left uncharged.
        trait SnapshotForbidden<A> {
            fn check() {}
        }
        impl<T: ?Sized> SnapshotForbidden<()> for T {}
        struct Copying;
        impl<T: Clone> SnapshotForbidden<Copying> for T {}
        let _ = <Effects as SnapshotForbidden<_>>::check;

        let program = Program::default();
        for n in [16, 64, 256] {
            let mut build = Builder::new(&program, Limits::default());
            let parent = Effects {
                writes: (0..n).map(|at| format!("own-{at}")).collect(),
                ..Effects::default()
            };
            build.contexts.push(context(parent));
            for _ in 0..n {
                build.contexts.push(context(Effects::default()));
                build.calls.push((0, build.contexts.len() - 1, ValueId(0)));
            }
            build.contexts[1].effects.writes.insert("late".to_owned());
            build.contexts[1].effects.suspension = true;
            let before = build.graph.work;
            build.effects();
            assert!(build.graph.failure.is_none());
            assert_eq!(build.contexts[0].effects.writes.len(), n + 1);
            assert!(build.contexts[0].effects.suspension);
            assert_eq!(build.graph.work - before, n + 1);
            println!(
                "memory-cost-control\teffects\tn={n}\twork={}",
                build.graph.work - before
            );
        }
    }

    #[test]
    fn unavailable_bodies_never_publish_pure_entry_summaries() {
        for abstract_declaration in [false, true] {
            for available in [false, true] {
                let mut entry = function("entry".to_owned(), Vec::new());
                entry.abstract_declaration = abstract_declaration;
                if !available {
                    entry.blocks.clear();
                }
                let program = Program {
                    funcs: vec![entry],
                    ..Program::default()
                };
                let report = analyze(&program, Limits::default());
                assert!(report.failure.is_none());
                let [summary] = report.functions.as_slice() else {
                    panic!("one entry summary")
                };
                let unknown = abstract_declaration || !available;
                assert_eq!(summary.unknown_effects, unknown);
                assert_eq!(summary.may_change_length, unknown);
                assert_eq!(summary.may_suspend, unknown);
                assert_eq!(summary.may_reenter, unknown);
            }
        }
    }

    #[test]
    fn missing_outcomes_root_live_before_references_and_their_held_graph() {
        for may_raise in [false, true] {
            let object = HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
            let mut caller = function(
                "caller#init".to_owned(),
                vec![
                    OpKind::ObjectNew { frame: false },
                    OpKind::ObjectNew { frame: false },
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field: 0,
                        value: ValueId(1),
                    },
                    OpKind::Call {
                        callee: Callee::Direct("ordinary".to_owned()),
                        args: Vec::new(),
                        frame: None,
                    },
                    OpKind::FieldGet {
                        object: ValueId(0),
                        field: 0,
                    },
                ],
            );
            for at in [0, 1, 4] {
                caller.values[at].ty = object.clone();
            }
            let kinds = if may_raise {
                vec![OpKind::Call {
                    callee: Callee::External("nts_raise".to_owned()),
                    args: Vec::new(),
                    frame: None,
                }]
            } else {
                Vec::new()
            };
            // Same ordinary name and void return type in both programs. Only
            // the actual placed body supplies (or defeats) NoRaise evidence.
            let ordinary = function("ordinary".to_owned(), kinds);
            let program = Program {
                funcs: vec![caller, ordinary],
                layouts: vec![Layout {
                    types: vec![super::super::super::TypeId(7)],
                    name: "held".to_owned(),
                    interfaces: Vec::new(),
                    base: None,
                    methods: Vec::new(),
                    fields: vec![super::super::super::Field {
                        name: super::super::super::PropertyKey::from("child"),
                        ty: object,
                        readonly: false,
                        written: None,
                        declared_by: None,
                    }],
                }],
                ..Program::default()
            };
            let report = analyze(&program, Limits::default());
            assert!(report.failure.is_none(), "{:?}", report.failure);
            let sites: Vec<_> = report
                .sites
                .iter()
                .filter(|site| site.id.function == "caller#init")
                .collect();
            assert_eq!(sites.len(), 2);
            if may_raise {
                assert!(sites.iter().all(|site| {
                    site.obligations
                        .iter()
                        .any(|why| matches!(why, Reason::MissingOutcome(_)))
                }));
                let fence = report
                    .outcomes
                    .iter()
                    .find(|outcome| outcome.function == "caller#init" && outcome.value == 3)
                    .unwrap();
                assert!(fence.live.contains(&0));
                assert!(
                    !fence.live.contains(&1),
                    "held graph is rooted transitively, not by a last local use"
                );
                assert!(
                    report
                        .proofs
                        .iter()
                        .any(|proof| proof.object == fence.payload)
                );
            } else {
                assert!(sites.iter().all(|site| site.home == Home::Frame));
                assert!(report.outcomes.is_empty());
            }
        }
    }

    #[test]
    fn missing_outcomes_include_last_use_operands() {
        let object = HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
        let mut caller = function(
            "caller#init".to_owned(),
            vec![
                OpKind::ObjectNew { frame: false },
                OpKind::Call {
                    callee: Callee::External("nts_raise".to_owned()),
                    args: vec![ValueId(0)],
                    frame: None,
                },
            ],
        );
        caller.values[0].ty = object;
        let report = analyze(
            &Program {
                funcs: vec![caller],
                ..Program::default()
            },
            Limits::default(),
        );
        assert!(report.failure.is_none());
        assert_eq!(report.outcomes.len(), 1);
        assert_eq!(report.outcomes[0].live, [0]);
        assert!(
            report.sites[0]
                .obligations
                .iter()
                .any(|why| matches!(why, Reason::MissingOutcome(_)))
        );
    }

    #[test]
    fn recursive_activations_keep_recent_and_older_instances() {
        let object = HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
        let init = function(
            "root#init".to_owned(),
            vec![OpKind::Call {
                callee: Callee::Direct("recursive".to_owned()),
                args: Vec::new(),
                frame: None,
            }],
        );
        let mut recursive = function(
            "recursive".to_owned(),
            vec![
                OpKind::ObjectNew { frame: false },
                OpKind::Call {
                    callee: Callee::Direct("recursive".to_owned()),
                    args: Vec::new(),
                    frame: None,
                },
                OpKind::FieldGet {
                    object: ValueId(0),
                    field: 0,
                },
            ],
        );
        recursive.values[0].ty = object;
        let report = analyze(
            &Program {
                funcs: vec![init, recursive],
                ..Program::default()
            },
            Limits::default(),
        );
        assert!(report.failure.is_none());
        assert!(matches!(
            report.sites[0].multiplicity,
            Multiplicity::Unbounded { .. }
        ));
        let value = report
            .values
            .iter()
            .find(|value| value.function == "recursive" && value.value == 0)
            .unwrap();
        assert!(value.aliases.iter().any(|alias| alias.ends_with(":recent")));
        assert!(value.aliases.iter().any(|alias| alias.ends_with(":older")));
    }

    #[test]
    fn a_loop_call_reexecutes_an_acyclic_callee_site() {
        let object = HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
        let mut init = function(
            "root#init".to_owned(),
            vec![
                OpKind::ConstBool(true),
                OpKind::Call {
                    callee: Callee::Direct("factory".to_owned()),
                    args: Vec::new(),
                    frame: None,
                },
            ],
        );
        init.values[0].ty = HirType::Bool;
        init.values[1].ty = object.clone();
        init.blocks = vec![
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
                ops: vec![ValueId(1)],
                terminator: Terminator::Branch {
                    cond: ValueId(0),
                    then_target: BlockId(1),
                    then_args: Vec::new(),
                    else_target: BlockId(2),
                    else_args: Vec::new(),
                },
            },
            Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: Terminator::Return(Some(ValueId(1))),
            },
        ];
        let mut factory = function(
            "factory".to_owned(),
            vec![OpKind::ObjectNew { frame: false }],
        );
        factory.values[0].ty = object.clone();
        factory.return_type = object;
        factory.blocks[0].terminator = Terminator::Return(Some(ValueId(0)));
        let report = analyze(
            &Program {
                funcs: vec![init, factory],
                ..Program::default()
            },
            Limits::default(),
        );
        assert!(report.failure.is_none());
        assert!(
            report
                .sites
                .iter()
                .all(|site| matches!(site.multiplicity, Multiplicity::Unbounded { .. }))
        );
        assert!(report.sites.iter().all(|site| site.home != Home::Frame));
    }

    #[test]
    fn retained_reactions_and_suspended_frames_publish_unbounded_multiplicity() {
        for suspension in [false, true] {
            let mut body = function(
                "root#init".to_owned(),
                vec![
                    OpKind::ObjectNew { frame: false },
                    OpKind::ObjectNew { frame: false },
                    if suspension {
                        OpKind::Suspend {
                            promise: ValueId(0),
                            frame: ValueId(1),
                            resume: "resume".to_owned(),
                        }
                    } else {
                        OpKind::PromiseSubscribe {
                            promise: ValueId(0),
                            reaction: ValueId(1),
                            slot: 0,
                        }
                    },
                ],
            );
            for at in [0, 1] {
                body.values[at].ty =
                    HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
            }
            let report = analyze(
                &Program {
                    funcs: vec![body],
                    ..Program::default()
                },
                Limits::default(),
            );
            assert!(report.failure.is_none());
            assert_eq!(report.sites.len(), 2);
            assert!(
                report
                    .sites
                    .iter()
                    .all(|site| matches!(site.multiplicity, Multiplicity::Unbounded { .. }))
            );
            assert!(report.sites.iter().all(|site| site.home != Home::Frame));
            assert!(!report.outcomes.is_empty());
        }
    }

    #[test]
    fn capture_order_reads_the_shared_writer_versions_and_keeps_retained_unknown() {
        let cell_id = super::super::super::TypeId(super::super::super::SYNTHETIC_CELLS);
        let env_id = super::super::super::TypeId(super::super::super::SYNTHETIC_CLOSURES);
        let cell = HirType::Managed(ManagedType::Object(cell_id));
        let environment = HirType::Managed(ManagedType::Object(env_id));
        for write_after in [false, true] {
            for retained in [false, true] {
                let mut body = function(
                    "root#init".to_owned(),
                    vec![
                        OpKind::ObjectNew { frame: false },
                        OpKind::ConstInt(1),
                        OpKind::FieldSet {
                            object: ValueId(0),
                            field: 0,
                            value: ValueId(1),
                        },
                        OpKind::ObjectNew { frame: false },
                        OpKind::FieldSet {
                            object: ValueId(3),
                            field: 0,
                            value: ValueId(0),
                        },
                        OpKind::ConstInt(3),
                        OpKind::FieldSet {
                            object: ValueId(0),
                            field: 0,
                            value: ValueId(5),
                        },
                    ],
                );
                body.values[0].ty = cell.clone();
                body.values[3].ty = environment.clone();
                body.values[1].ty = HirType::NUMBER;
                body.values[5].ty = HirType::NUMBER;
                if !write_after {
                    body.blocks[0].ops = vec![
                        ValueId(0),
                        ValueId(1),
                        ValueId(2),
                        ValueId(3),
                        ValueId(5),
                        ValueId(6),
                        ValueId(4),
                    ];
                }
                if retained {
                    body.blocks[0].terminator = Terminator::Return(Some(ValueId(3)));
                    body.return_type = environment.clone();
                }
                let field = |name: &str, ty, readonly| super::super::super::Field {
                    name: name.into(),
                    ty,
                    readonly,
                    written: None,
                    declared_by: None,
                };
                let program = Program {
                    funcs: vec![body],
                    layouts: vec![
                        Layout {
                            types: vec![cell_id],
                            name: "binding".to_owned(),
                            fields: vec![field("value", HirType::NUMBER, false)],
                            methods: Vec::new(),
                            interfaces: Vec::new(),
                            base: None,
                        },
                        Layout {
                            types: vec![env_id],
                            name: "environment".to_owned(),
                            fields: vec![field("captured", cell.clone(), true)],
                            methods: Vec::new(),
                            interfaces: Vec::new(),
                            base: None,
                        },
                    ],
                    ..Program::default()
                };
                let report = analyze(&program, Limits::default());
                assert!(report.failure.is_none(), "{:?}", report.failure);
                assert_eq!(report.store_versions.len(), 3);
                assert_eq!(report.captures.len(), 1);
                let answer = &report.captures[0].later_write;
                if write_after {
                    assert!(
                        matches!(answer, super::super::LaterWrite::MayWrite { .. }),
                        "{answer:?}"
                    );
                } else if retained {
                    assert!(
                        matches!(
                            answer,
                            super::super::LaterWrite::Unknown(Reason::RetainedEnvironment(_))
                        ),
                        "{answer:?}"
                    );
                } else {
                    assert!(
                        matches!(answer, super::super::LaterWrite::ProvedNone { .. }),
                        "{answer:?}"
                    );
                }
                assert!(
                    report
                        .event_changes
                        .iter()
                        .all(|changes| *changes <= report.state_change_limit)
                );
                assert!(
                    report
                        .store_versions
                        .iter()
                        .filter(|store| store.value != 4)
                        .all(|store| store.payload.has_only(Tags::NUMBER))
                );
            }
        }
    }

    fn review_await_program(ordinary_handler_edge: bool) -> Program {
        let mut body = function(
            "review#init".to_owned(),
            vec![
                OpKind::Call {
                    callee: Callee::External("nts_promise_new".to_owned()),
                    args: Vec::new(),
                    frame: None,
                },
                OpKind::Await {
                    promise: ValueId(0),
                    rejects_to: Some(super::super::super::Rejection {
                        handler: BlockId(2),
                        args: Vec::new(),
                        reason_at: 0,
                    }),
                },
                OpKind::BlockParam(0),
                OpKind::ObjectNew { frame: false },
                OpKind::ConstInt(3),
                OpKind::FieldSet {
                    object: ValueId(3),
                    field: 0,
                    value: ValueId(4),
                },
                OpKind::ConstUndefined,
            ],
        );
        let object = HirType::Managed(ManagedType::Object(super::super::super::TypeId(7)));
        body.values[0].ty = HirType::Managed(ManagedType::Promise(Box::new(HirType::NUMBER)));
        body.values[2].ty = HirType::Erased;
        body.values[3].ty = object;
        body.values[4].ty = HirType::NUMBER;
        body.values[6].ty = HirType::Erased;
        body.blocks = vec![
            Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(6), ValueId(1)],
                terminator: Terminator::Jump {
                    target: if ordinary_handler_edge {
                        BlockId(2)
                    } else {
                        BlockId(1)
                    },
                    args: if ordinary_handler_edge {
                        vec![ValueId(6)]
                    } else {
                        Vec::new()
                    },
                },
            },
            Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: Terminator::Return(None),
            },
            Block {
                params: vec![ValueId(2)],
                ops: vec![ValueId(3), ValueId(4), ValueId(5)],
                terminator: Terminator::Return(None),
            },
        ];
        Program {
            funcs: vec![body],
            layouts: vec![Layout {
                types: vec![super::super::super::TypeId(7)],
                name: "handler".to_owned(),
                fields: vec![super::super::super::Field {
                    name: "value".into(),
                    ty: HirType::NUMBER,
                    readonly: false,
                    written: None,
                    declared_by: None,
                }],
                methods: Vec::new(),
                interfaces: Vec::new(),
                base: None,
            }],
            ..Program::default()
        }
    }

    fn review_await_inventory(ordinary_handler_edge: bool) {
        let program = review_await_program(ordinary_handler_edge);
        let report = crate::hir::memory::Analysis::of(&program).into_report();
        println!(
            "review-await\tordinary={ordinary_handler_edge}\tsites={:?}\tstores={:?}\tfailure={:?}",
            report
                .sites
                .iter()
                .map(|site| site.id.value)
                .collect::<Vec<_>>(),
            report
                .store_versions
                .iter()
                .map(|store| store.value)
                .collect::<Vec<_>>(),
            report.failure
        );
        assert!(
            report
                .sites
                .iter()
                .any(|site| site.id.function == "review#init" && site.id.value == 3),
            "the accepted public endpoint cannot omit a placed handler allocation"
        );
        assert!(
            report
                .store_versions
                .iter()
                .any(|store| store.function == "review#init" && store.value == 5),
            "the accepted public endpoint cannot omit its handler write"
        );
    }

    #[test]
    fn review_await_only_handler_subject_keeps_complete_inventory() {
        review_await_inventory(false);
    }

    #[test]
    fn review_ordinary_handler_edge_control_keeps_complete_inventory() {
        review_await_inventory(true);
    }

    #[test]
    fn review_unsealed_functions_visit_only_their_indexed_contexts() {
        let mut counts = Vec::new();
        for n in [16, 64, 256] {
            let program = Program {
                funcs: (0..n)
                    .map(|at| {
                        function(
                            format!("unsealed-{at}"),
                            vec![OpKind::Call {
                                callee: Callee::External("nts_raise".to_owned()),
                                args: Vec::new(),
                                frame: None,
                            }],
                        )
                    })
                    .collect(),
                ..Program::default()
            };
            let report = crate::hir::memory::Analysis::of(&program).into_report();
            assert!(report.failure.is_none(), "n={n}: {:?}", report.failure);
            assert_eq!(report.contexts, n);
            println!(
                "review-fence-contexts\tn={n}\tvisits={}\twork={}",
                report.context_membership_visits, report.work
            );
            counts.push((n, report.context_membership_visits));
        }
        assert!(
            counts.iter().all(|(n, visits)| *visits <= 2 * n),
            "actual context visits must be linear: {counts:?}"
        );
    }

    #[test]
    fn a_shared_dispatch_slot_has_one_target_index_and_preserves_first_seen_order() {
        for n in [16, 64, 256] {
            for closure in [false, true] {
                for cyclic in [false, true] {
                    let call = if closure {
                        Callee::Closure { slot: 0 }
                    } else {
                        Callee::Virtual {
                            slot: 0,
                            declared: "method".to_owned(),
                        }
                    };
                    let mut program = Program::default();
                    program.funcs.push(function(
                        "root".to_owned(),
                        (0..n)
                            .map(|_| OpKind::Call {
                                callee: call.clone(),
                                args: Vec::new(),
                                frame: None,
                            })
                            .collect(),
                    ));
                    for at in 0..n {
                        let kinds = if cyclic && at == 0 {
                            vec![OpKind::Call {
                                callee: Callee::Direct("root".to_owned()),
                                args: Vec::new(),
                                frame: None,
                            }]
                        } else {
                            Vec::new()
                        };
                        program.funcs.push(function(format!("impl-{at}"), kinds));
                    }
                    // Reverse implementation order and repeat each supplier.
                    // Membership acceleration must retain the existing order.
                    for at in (0..n).rev() {
                        for _ in 0..2 {
                            program.layouts.push(Layout {
                                types: Vec::new(),
                                name: format!("layout-{at}"),
                                interfaces: Vec::new(),
                                fields: Vec::new(),
                                methods: vec![Some(format!("impl-{at}"))],
                                base: None,
                            });
                        }
                    }
                    assert_eq!(
                        program.slot_targets()[&0],
                        (1..=n).rev().collect::<Vec<_>>()
                    );
                    let calls = CallGraph::of(&program);
                    assert_eq!(calls.index_edges, n + 1 + usize::from(cyclic));
                    assert!(calls.work <= 20 * n + 32, "n={n}: {}", calls.work);
                    assert_eq!(calls.recursive.contains(&0), cyclic);
                    assert_eq!(calls.recursive.contains(&1), cyclic);
                    assert!(calls.recursive.iter().all(|at| *at <= 1));
                    println!(
                        "memory-cost-control\tcall-index\tn={n}\tclosure={closure}\tcyclic={cyclic}\tedges={}\twork={}",
                        calls.index_edges, calls.work
                    );
                    let mut build = Builder::new(&program, Limits::default());
                    let parent = build.context(0, None, None);
                    build.graph.work_limit = build.graph.work + n - 1;
                    for at in 0..n {
                        build.call(
                            parent,
                            ValueId(u32::try_from(at).expect("test call")),
                            &call,
                            &[],
                            false,
                        );
                    }
                    assert_eq!(build.graph.failure, Some(Reason::WorkBudget));
                    assert_eq!(
                        build.contexts.len(),
                        1,
                        "exhaustion cannot keep expanding dispatches"
                    );
                }
            }
        }
    }
}

impl Effects {
    /// Join only the incoming delta's entries. A snapshot of the parent would
    /// copy its accumulated writes once for every incoming call edge.
    fn absorb(&mut self, child: &Self, graph: &mut Graph) -> Option<bool> {
        let mut changed = false;
        for field in &child.writes {
            if !graph.charge() {
                return None;
            }
            changed |= self.writes.insert(field.clone());
        }
        changed |= child.length && !self.length;
        changed |= child.suspension && !self.suspension;
        changed |= child.reentrant && !self.reentrant;
        changed |= child.unknown && !self.unknown;
        self.length |= child.length;
        self.suspension |= child.suspension;
        self.reentrant |= child.reentrant;
        self.unknown |= child.unknown;
        Some(changed)
    }
}

#[derive(Debug)]
struct Context {
    function: usize,
    key: String,
    parent: Option<usize>,
    call: Option<ValueId>,
    ancestors: Vec<usize>,
    values: BTreeMap<ValueId, Node>,
    result: Node,
    fallback: bool,
    repeated: bool,
    effects: Effects,
}

#[derive(Debug)]
struct Allocation {
    id: SiteId,
    context: usize,
    object: Object,
    repeated: bool,
    fallback: bool,
}

struct Builder<'p> {
    program: &'p Program,
    limits: Limits,
    graph: Graph,
    contexts: Vec<Context>,
    counts: Vec<usize>,
    fallback_contexts: Vec<Option<usize>>,
    pending: VecDeque<usize>,
    by_name: BTreeMap<&'p str, usize>,
    targets: BTreeMap<u32, Vec<usize>>,
    layouts: BTreeMap<super::super::TypeId, usize>,
    field_slots: Vec<Vec<Slot>>,
    reference_layouts: Vec<bool>,
    components: Vec<usize>,
    recursive: BTreeSet<usize>,
    raises: Vec<bool>,
    reenters: Vec<bool>,
    globals: Vec<Node>,
    globals_opened: bool,
    parameters: Vec<Vec<(ValueId, u32)>>,
    allocations: Vec<Allocation>,
    roots: Vec<(Node, Exposure)>,
    calls: Vec<(usize, usize, ValueId)>,
    operations: usize,
    stages: Vec<(String, usize)>,
    cycles: Vec<Result<cfg::CyclicBlocks<'p>, cfg::CfgError>>,
    value_blocks: Vec<BTreeMap<ValueId, BlockId>>,
    summaries: Vec<Option<Summary>>,
    summary_used: Vec<bool>,
    context_membership_visits: usize,
}

pub(super) fn analyze(program: &Program, limits: Limits) -> Report {
    let mut build = Builder::new(program, limits);
    let outside = reachable::outside_callers(program);
    for (at, function) in program.funcs.iter().enumerate() {
        if outside.contains(function.name.as_str()) || function.name.ends_with("#init") {
            let context = build.context(at, None, None);
            build.seed_parameters(context);
        }
    }
    // Any body left after pruning but reached only by an opaque protocol or
    // host route is a real external entry, never an empty-caller proof.
    let mut unseen = 0;
    loop {
        while let Some(context) = build.pending.pop_front() {
            build.body(context);
        }
        while unseen < build.counts.len()
            && (build.counts[unseen] != 0 || build.summary_used[unseen])
        {
            unseen += 1;
        }
        if unseen == build.counts.len() {
            break;
        }
        let context = build.context(unseen, None, None);
        build.seed_parameters(context);
    }
    build.stages.push((
        "construction".to_owned(),
        build.graph.work - build.stages[0].1,
    ));
    let start = build.graph.work;
    build.graph.solve();
    build
        .stages
        .push(("propagation".to_owned(), build.graph.work - start));
    let start = build.graph.work;
    build.effects();
    build
        .stages
        .push(("effects".to_owned(), build.graph.work - start));
    build.finish()
}

struct CallGraph<'p> {
    by_name: BTreeMap<&'p str, usize>,
    targets: BTreeMap<u32, Vec<usize>>,
    components: Vec<usize>,
    recursive: BTreeSet<usize>,
    raises: Vec<bool>,
    reenters: Vec<bool>,
    work: usize,
    #[cfg(test)]
    index_edges: usize,
}

impl<'p> CallGraph<'p> {
    fn of(program: &'p Program) -> Self {
        let by_name: BTreeMap<_, _> = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| (func.name.as_str(), at))
            .collect();
        let targets: BTreeMap<_, _> = program
            .slot_targets()
            .into_iter()
            .map(|(slot, mut targets)| {
                targets.sort_unstable();
                targets.dedup();
                (slot, targets)
            })
            .collect();
        // Each slot owns its target set once. Repeating that set at each call
        // site makes even the initial SCC index quadratic before budgets exist.
        let slots: BTreeMap<_, _> = targets
            .keys()
            .enumerate()
            .map(|(at, slot)| (*slot, program.funcs.len() + at))
            .collect();
        let mut edges: Vec<Vec<usize>> = program
            .funcs
            .iter()
            .map(|func| {
                func.blocks
                    .iter()
                    .flat_map(|block| &block.ops)
                    .filter_map(|id| match &func.values.get(id.0 as usize)?.kind {
                        OpKind::Call {
                            callee: Callee::Direct(name),
                            ..
                        } => by_name.get(name.as_str()).copied(),
                        OpKind::Call {
                            callee: Callee::Virtual { slot, .. } | Callee::Closure { slot },
                            ..
                        } => slots.get(slot).copied(),
                        _ => None,
                    })
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            })
            .collect();
        edges.extend(targets.values().cloned());
        let index_edges = edges.iter().map(Vec::len).sum::<usize>();
        let work = program.funcs.len().saturating_mul(2)
            + program
                .layouts
                .iter()
                .map(|layout| layout.methods.len())
                .sum::<usize>()
            + program
                .funcs
                .iter()
                .flat_map(|func| &func.blocks)
                .map(|block| block.ops.len())
                .sum::<usize>()
            + edges.len()
            + index_edges;
        let (raises, reenters, outcome_work) = outcomes::escaping(program, &edges, &by_name);
        let work = work.saturating_add(outcome_work);
        let components = super::super::strongly_connected(&edges);
        let recursive = edges
            .iter()
            .take(program.funcs.len())
            .enumerate()
            .filter_map(|(at, targets)| {
                targets
                    .iter()
                    .any(|to| components[at] == components[*to])
                    .then_some(at)
            })
            .collect();
        Self {
            by_name,
            targets,
            components,
            recursive,
            raises,
            reenters,
            work,
            #[cfg(test)]
            index_edges,
        }
    }
}

fn slot_names(program: &Program) -> Vec<Vec<Slot>> {
    program
        .layouts
        .iter()
        .map(|layout| {
            layout
                .fields
                .iter()
                .map(|field| {
                    let owner = if matches!(field.name, super::super::PropertyKey::Private(_)) {
                        field.declared_by
                    } else {
                        None
                    };
                    Slot::Field(format!("{:?}@{owner:?}", field.name))
                })
                .collect()
        })
        .collect()
}

fn parameters(program: &Program, graph: &mut Graph) -> Vec<Vec<(ValueId, u32)>> {
    program
        .funcs
        .iter()
        .map(|function| {
            // A coroutine's frame parameter belongs to its ABI even when it is
            // absent from block.ops. Use the same authority as forwarding/verifying.
            let Some(values) = function.parameter_values() else {
                graph.failure.get_or_insert(Reason::ProducerUnproved);
                return Vec::new();
            };
            values
                .into_iter()
                .enumerate()
                .filter_map(|(slot, value)| {
                    value.map(|id| (id, u32::try_from(slot).unwrap_or(u32::MAX)))
                })
                .collect()
        })
        .collect()
}

impl<'p> Builder<'p> {
    fn new(program: &'p Program, limits: Limits) -> Self {
        let cycles: Vec<_> = program.funcs.iter().map(cfg::cyclic_blocks).collect();
        let cfg_failure = cycles
            .iter()
            .find_map(|cycle| cycle.as_ref().err())
            .map(|error| Reason::InvalidControlFlow(error.to_string()));
        let cfg_work = program
            .funcs
            .iter()
            .map(|function| {
                4 * function.blocks.len()
                    + function
                        .blocks
                        .iter()
                        .map(|block| {
                            2 * block.ops.len()
                                + 3 * block.terminator.successors().len()
                                + 3 * block
                                    .ops
                                    .iter()
                                    .filter(|id| {
                                        matches!(
                                            function.values.get(id.0 as usize).map(|op| &op.kind),
                                            Some(OpKind::Await {
                                                rejects_to: Some(_),
                                                ..
                                            })
                                        )
                                    })
                                    .count()
                        })
                        .sum::<usize>()
            })
            .sum::<usize>();
        let value_blocks = program
            .funcs
            .iter()
            .map(|function| {
                function
                    .blocks
                    .iter()
                    .enumerate()
                    .flat_map(|(at, block)| {
                        block
                            .ops
                            .iter()
                            .map(move |id| (*id, BlockId(u32::try_from(at).unwrap_or(u32::MAX))))
                    })
                    .collect()
            })
            .collect();
        let calls = CallGraph::of(program);
        let operations = program
            .funcs
            .iter()
            .flat_map(|func| &func.blocks)
            .map(|block| block.ops.len() + block.params.len())
            .sum::<usize>();
        let layouts = program
            .layouts
            .iter()
            .enumerate()
            .flat_map(|(at, layout)| layout.types.iter().map(move |ty| (*ty, at)))
            .collect();
        let field_slots = slot_names(program);
        let reference_layouts = program
            .layouts
            .iter()
            .map(|layout| !layout.reference_fields().is_empty())
            .collect();
        let expansion = limits.contexts_per_function.saturating_add(1);
        let input = operations.max(1).saturating_mul(expansion);
        let mut graph = Graph::new(
            input.saturating_mul(limits.work_per_operation),
            input.saturating_mul(limits.edges_per_operation),
        );
        graph.work = calls.work.saturating_add(cfg_work);
        graph.failure = cfg_failure;
        if graph.work > graph.work_limit {
            graph.failure = Some(Reason::WorkBudget);
        }
        graph.alias_limit = limits.aliases_per_value;
        let globals = program.globals.iter().map(|_| graph.node()).collect();
        let parameters = parameters(program, &mut graph);
        let mut build = Self {
            program,
            limits,
            graph,
            contexts: Vec::new(),
            counts: vec![0; program.funcs.len()],
            fallback_contexts: vec![None; program.funcs.len()],
            pending: VecDeque::new(),
            by_name: calls.by_name,
            targets: calls.targets,
            layouts,
            field_slots,
            reference_layouts,
            components: calls.components,
            recursive: calls.recursive,
            raises: calls.raises,
            reenters: calls.reenters,
            globals,
            globals_opened: false,
            parameters,
            allocations: Vec::new(),
            roots: Vec::new(),
            calls: Vec::new(),
            operations,
            stages: vec![(
                "call-and-cfg-index".to_owned(),
                calls.work.saturating_add(cfg_work),
            )],
            cycles,
            value_blocks,
            summaries: Vec::new(),
            summary_used: vec![false; program.funcs.len()],
            context_membership_visits: 0,
        };
        build.summaries = program
            .funcs
            .iter()
            .map(|function| Summary::of(function, |ty, index| build.field(ty, index)))
            .collect();
        build
    }

    fn context(&mut self, function: usize, parent: Option<usize>, call: Option<ValueId>) -> usize {
        if let Some(parent) = parent {
            for &ancestor in self.contexts[parent].ancestors.iter().rev() {
                if self.contexts[ancestor].function == function
                    && self.components[self.contexts[parent].function] == self.components[function]
                {
                    return ancestor;
                }
            }
            if self.contexts[parent].function == function {
                return parent;
            }
        }
        let fallback = self.counts[function] >= self.limits.contexts_per_function
            || parent.is_some_and(|parent| {
                self.contexts[parent].ancestors.len() >= self.limits.context_depth
            });
        if fallback && let Some(at) = self.fallback_contexts[function] {
            return at;
        }
        let name = &self.program.funcs[function].name;
        let repeated = fallback
            || self.recursive.contains(&function)
            || self.reenters[function]
            || match (parent, call) {
                (Some(parent), Some(call)) => {
                    let owner = &self.contexts[parent];
                    owner.repeated
                        || self.value_blocks[owner.function]
                            .get(&call)
                            .and_then(|block| {
                                self.cycles[owner.function]
                                    .as_ref()
                                    .ok()
                                    .and_then(|cycle| cycle.is_cyclic(*block))
                            })
                            != Some(false)
                }
                // An opaque or host entry has no bound on simultaneous
                // invocations. A module's initialization activation is unique.
                _ => !name.ends_with("#init"),
            };
        let key = if fallback {
            format!("{name}:merged")
        } else if let (Some(parent), Some(call)) = (parent, call) {
            format!("{}/{}:%{}", self.contexts[parent].key, name, call.0)
        } else {
            format!("{name}:entry")
        };
        let mut ancestors = parent.map_or_else(Vec::new, |parent| {
            let mut ancestors = self.contexts[parent].ancestors.clone();
            ancestors.push(parent);
            ancestors
        });
        // A merged context has no caller-specific lifetime promise.
        if fallback {
            ancestors.clear();
        }
        let live: BTreeSet<_> = self.program.funcs[function]
            .blocks
            .iter()
            .flat_map(|block| block.params.iter().chain(&block.ops))
            .chain(self.parameters[function].iter().map(|(id, _)| id))
            .copied()
            .collect();
        let values = live.into_iter().map(|id| (id, self.graph.node())).collect();
        let result = self.graph.node();
        let at = self.contexts.len();
        self.contexts.push(Context {
            function,
            key,
            parent,
            call,
            ancestors,
            values,
            result,
            fallback,
            repeated,
            effects: Effects::default(),
        });
        self.counts[function] += 1;
        if fallback {
            self.fallback_contexts[function] = Some(at);
        }
        self.pending.push_back(at);
        if at == 0 {
            for (index, global) in self.program.globals.iter().enumerate() {
                if global.exported && global.ty.may_hold_a_reference() {
                    self.graph.replaceable(self.globals[index]);
                    self.roots.push((
                        self.globals[index],
                        Exposure::Outside(format!("exported module slot {index}")),
                    ));
                }
            }
        }
        // Context merging unions every known caller's actual arguments. It
        // does not create a foreign entry or an unseen writer. Allocations in
        // the merged context still receive Heap(ContextBudget), and no return
        // from it grants a caller-specific lifetime promise.
        at
    }

    fn value(&self, context: usize, value: ValueId) -> Node {
        *self.contexts[context]
            .values
            .get(&value)
            .unwrap_or_else(|| {
                panic!(
                    "memory input {} missing %{value:?}: {:?}",
                    self.contexts[context].key,
                    self.program.funcs[self.contexts[context].function]
                        .value(value)
                        .kind
                )
            })
    }

    fn outside(&mut self, context: usize, value: Node, label: String) {
        self.roots.push((value, Exposure::Outside(label.clone())));
        self.graph.object(
            ObjectInfo {
                label,
                site: None,
                context,
                instance: Instance::Summary,
                open: true,
            },
            value,
        );
        self.graph
            .payload(value, ValueFact::Unknown(Unknown::ExternalValue));
    }

    fn seed_parameters(&mut self, context: usize) {
        let index = self.contexts[context].function;
        let function = &self.program.funcs[index];
        for (id, slot) in self.parameters[index].clone() {
            let value = self.value(context, id);
            if function.value(id).ty.may_hold_a_reference() {
                self.outside(
                    context,
                    value,
                    format!("{}:parameter:{slot}", self.contexts[context].key),
                );
            } else {
                self.graph
                    .payload(value, ValueFact::Unknown(Unknown::ExternalValue));
            }
        }
    }

    fn allocation(
        &mut self,
        context: usize,
        id: ValueId,
        storage: Storage,
        repeated: bool,
    ) -> Object {
        let function = &self.program.funcs[self.contexts[context].function];
        let site = self.allocations.len();
        let label = format!("{}:%{}:{storage:?}", self.contexts[context].key, id.0);
        let value = self.value(context, id);
        let object = self.graph.object(
            ObjectInfo {
                label: format!("{label}:recent"),
                site: Some(site),
                context,
                instance: Instance::Recent,
                open: false,
            },
            value,
        );
        if repeated {
            let older_value = self.graph.node();
            let older = self.graph.object(
                ObjectInfo {
                    label: format!("{label}:older"),
                    site: Some(site),
                    context,
                    instance: Instance::Summary,
                    open: false,
                },
                older_value,
            );
            self.graph.join_instances(object, older);
            // Until a CFG memory-version proof distinguishes executions, a
            // repeated SSA producer conservatively denotes either instance.
            self.graph.copy(older_value, value);
        }
        self.allocations.push(Allocation {
            id: SiteId {
                function: function.name.clone(),
                value: id.0,
                storage,
            },
            context,
            object,
            repeated,
            fallback: self.contexts[context].fallback,
        });
        object
    }

    fn field(&self, ty: &HirType, index: u32) -> Option<Slot> {
        let HirType::Managed(ManagedType::Object(id)) = ty else {
            return None;
        };
        self.field_slots
            .get(*self.layouts.get(id)?)?
            .get(index as usize)
            .cloned()
    }

    fn opaque(&mut self, context: usize, id: ValueId, args: &[ValueId], label: &str) {
        self.graph
            .unknown_events
            .entry(super::events::Origin { context, value: id })
            .or_insert_with(|| {
                Reason::UnsealedWriter(format!("{}:%{}: {label}", self.contexts[context].key, id.0))
            });
        let op = self.program.funcs[self.contexts[context].function].value(id);
        if matches!(op.kind, OpKind::Call { .. }) {
            if op.ty.is_counted() {
                self.allocation(context, id, Storage::CallResult, true);
            }
            self.backing(context, id, None);
        }
        self.contexts[context].effects.unknown = true;
        self.contexts[context].effects.length = true;
        self.contexts[context].effects.reentrant = true;
        for arg in args {
            let value = self.value(context, *arg);
            self.graph.open(value);
            self.roots.push((
                value,
                Exposure::Outside(format!(
                    "{label} at {}:%{}",
                    self.contexts[context].key, id.0
                )),
            ));
        }
        if !self.globals_opened {
            self.globals_opened = true;
            for (index, global) in self.globals.iter().copied().enumerate() {
                self.graph.replaceable(global);
                self.roots.push((
                    global,
                    Exposure::Outside(format!("opaque module-slot writer {index}")),
                ));
            }
        }
        let value = self.value(context, id);
        if op.ty.may_hold_a_reference() {
            self.outside(
                context,
                value,
                format!("{}:%{}:outside", self.contexts[context].key, id.0),
            );
        } else {
            self.graph
                .payload(value, ValueFact::Unknown(Unknown::ExternalValue));
        }
    }

    fn body(&mut self, context: usize) {
        let function_index = self.contexts[context].function;
        let function = &self.program.funcs[function_index];
        // The detached entry row follows the same unavailable-body authority
        // as calls. No body is not a proof that the function has no effects.
        if function.abstract_declaration || function.blocks.is_empty() {
            self.contexts[context].effects = Effects {
                length: true,
                suspension: true,
                reentrant: true,
                unknown: true,
                ..Effects::default()
            };
            return;
        }
        if self.cycles[function_index].is_err() {
            return;
        }
        for block in verify::reverse_postorder(function) {
            let repeated = self.contexts[context].repeated
                || self.cycles[function_index]
                    .as_ref()
                    .ok()
                    .and_then(|cycle| cycle.is_cyclic(block))
                    != Some(false);
            for &id in &function.blocks[block.0 as usize].ops {
                // Inventory still completes after exhaustion. Graph mutations
                // stop charging/publishing facts, and every home becomes Heap.
                self.graph.charge();
                self.operation(context, id, repeated);
            }
            let block = &function.blocks[block.0 as usize];
            match &block.terminator {
                Terminator::Return(Some(id)) => {
                    let value = self.value(context, *id);
                    self.graph.copy(value, self.contexts[context].result);
                    self.roots.push((value, Exposure::Returned(context)));
                }
                Terminator::Jump { target, args } => self.edge(context, *target, args),
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => {
                    self.edge(context, *then_target, then_args);
                    self.edge(context, *else_target, else_args);
                }
                _ => {}
            }
        }
    }

    fn edge(&mut self, context: usize, target: BlockId, args: &[ValueId]) {
        let function = &self.program.funcs[self.contexts[context].function];
        for (&arg, &parameter) in args.iter().zip(&function.blocks[target.0 as usize].params) {
            self.graph
                .copy(self.value(context, arg), self.value(context, parameter));
        }
    }

    #[allow(clippy::too_many_lines)]
    fn operation(&mut self, context: usize, id: ValueId, repeated: bool) {
        self.graph.event = Some(super::events::Origin { context, value: id });
        let function = &self.program.funcs[self.contexts[context].function];
        let op = function.value(id);
        let into = self.value(context, id);
        let known = |tags| ValueFact::Known {
            tags,
            numbers: facts::Facts::BOTTOM,
        };
        match &op.kind {
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } => {
                let storage = if matches!(op.kind, OpKind::ObjectNew { .. }) {
                    Storage::Object
                } else {
                    Storage::Array
                };
                self.allocation(context, id, storage, repeated);
                let tags = super::super::tags::of_prepared(self.program, &op.ty)
                    .and_then(Tags::from_runtime)
                    .unwrap_or(Tags::REFERENCE);
                self.graph.payload(into, known(tags));
                // Until the reset/runtime contract can discharge a buffered
                // array's walk, source-level last use alone proves too little.
                if matches!(&op.ty, HirType::Managed(ManagedType::Array(element))
                    if element.may_hold_a_reference())
                    || (repeated
                        && matches!(&op.ty, HirType::Managed(ManagedType::Object(id))
                        if self.layouts.get(id).is_none_or(|layout| self.reference_layouts[*layout])))
                {
                    self.roots.push((into, Exposure::Collector));
                }
            }
            OpKind::NativeMalloc { .. } => {
                self.allocation(context, id, Storage::Native, repeated);
            }
            OpKind::Binary {
                op: BinOp::Concat, ..
            } => {
                self.allocation(context, id, Storage::String, repeated);
                self.graph.payload(into, known(Tags::STRING));
            }
            OpKind::Binary {
                op: binary,
                lhs,
                rhs,
            } => {
                // HIR operators are resolved primitive operations. Any
                // toString/valueOf/Symbol.toPrimitive work is a preceding
                // call edge; equality itself invokes no user code.
                let comparison = matches!(
                    binary,
                    BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge
                );
                let scalar = !function.value(*lhs).ty.may_hold_a_reference()
                    && !function.value(*rhs).ty.may_hold_a_reference();
                let strings = matches!(
                    function.value(*lhs).ty,
                    HirType::Managed(ManagedType::String)
                ) && matches!(
                    function.value(*rhs).ty,
                    HirType::Managed(ManagedType::String)
                );
                if matches!(binary, BinOp::Eq | BinOp::Ne) || (comparison && (scalar || strings)) {
                    self.graph.payload(into, known(Tags::BOOLEAN));
                } else if scalar {
                    self.graph.payload(
                        into,
                        if op.ty == HirType::BigInt {
                            known(Tags::BIGINT)
                        } else {
                            ValueFact::number(facts::Facts::TOP)
                        },
                    );
                } else {
                    self.opaque(
                        context,
                        id,
                        &[*lhs, *rhs],
                        "unresolved primitive conversion",
                    );
                }
            }
            OpKind::Param(_) | OpKind::BlockParam(_) => {}
            OpKind::ConstInt(n) if op.ty != HirType::BigInt => {
                #[allow(clippy::cast_precision_loss)]
                let number = if n.unsigned_abs() <= 9_007_199_254_740_991 {
                    facts::Facts::constant(*n as f64)
                } else {
                    facts::Facts::TOP
                };
                self.graph.payload(into, ValueFact::number(number));
            }
            OpKind::ConstFloat(n) => self
                .graph
                .payload(into, ValueFact::number(facts::Facts::constant(*n))),
            OpKind::ConstBool(_) => self.graph.payload(into, known(Tags::BOOLEAN)),
            OpKind::ConstInt(_) => self.graph.payload(into, known(Tags::BIGINT)),
            OpKind::ConstNull => self.graph.payload(into, known(Tags::NULL)),
            OpKind::ConstUndefined => self.graph.payload(into, ValueFact::undefined()),
            OpKind::ConstString(_) | OpKind::ConstTemplate { .. } | OpKind::ClosureStatic => {
                self.graph.object(
                    ObjectInfo {
                        label: format!("{}:%{}:immortal", self.contexts[context].key, id.0),
                        site: None,
                        context,
                        instance: Instance::Summary,
                        open: false,
                    },
                    into,
                );
                let tags = match op.kind {
                    OpKind::ClosureStatic => Tags::FUNCTION,
                    OpKind::ConstTemplate { .. } => Tags::OBJECT,
                    _ => Tags::STRING,
                };
                self.graph.payload(into, known(tags));
            }
            OpKind::Erase { value, .. }
            | OpKind::Unerase { value, .. }
            | OpKind::FieldView { value, .. }
            | OpKind::OptionalPayload(value) => self.graph.copy(self.value(context, *value), into),
            OpKind::Convert(value)
                if op.ty.may_hold_a_reference()
                    && function.value(*value).ty.may_hold_a_reference() =>
            {
                self.graph.copy(self.value(context, *value), into);
            }
            OpKind::Optional { payload, .. } => {
                self.graph.copy(self.value(context, *payload), into);
                self.graph.payload(into, ValueFact::undefined());
            }
            OpKind::GlobalGet(global) => self.graph.copy(self.globals[*global as usize], into),
            OpKind::GlobalSet { global, value } => {
                self.graph
                    .copy(self.value(context, *value), self.globals[*global as usize]);
                self.roots.push((
                    self.value(context, *value),
                    Exposure::Outside(format!("module slot {global}")),
                ));
                self.contexts[context]
                    .effects
                    .writes
                    .insert(format!("global:{global}"));
            }
            OpKind::FieldGet { object, field } => {
                if let Some(slot) = self.field(&function.value(*object).ty, *field) {
                    self.graph.load(self.value(context, *object), slot, into);
                } else {
                    self.opaque(context, id, &[*object], "unresolved field read");
                }
            }
            OpKind::FieldSet {
                object,
                field,
                value,
            } => {
                if let Some(slot) = self.field(&function.value(*object).ty, *field) {
                    self.contexts[context]
                        .effects
                        .writes
                        .insert(format!("{slot:?}"));
                    self.graph.store(
                        self.value(context, *object),
                        slot,
                        self.value(context, *value),
                    );
                } else {
                    self.opaque(context, id, &[*object, *value], "unresolved field write");
                }
            }
            OpKind::ArrayGet { array, .. } => {
                self.graph
                    .load(self.value(context, *array), Slot::Elements, into);
                // An element payload fact is not a presence/density proof.
                self.graph.payload(into, ValueFact::undefined());
            }
            OpKind::ArraySet { array, value, .. } => {
                self.graph.store(
                    self.value(context, *array),
                    Slot::Elements,
                    self.value(context, *value),
                );
                self.contexts[context]
                    .effects
                    .writes
                    .insert("elements".to_owned());
                self.contexts[context].effects.length |=
                    super::super::array_write_may_grow(function, *array);
            }
            OpKind::Call { callee, args, .. } => self.call(context, id, callee, args, repeated),
            OpKind::Suspend { promise, frame, .. } => {
                self.contexts[context].effects.suspension = true;
                self.opaque(context, id, &[*promise, *frame], "suspended continuation");
            }
            OpKind::PromiseSubscribe {
                promise, reaction, ..
            } => {
                self.contexts[context].effects.suspension = true;
                self.opaque(
                    context,
                    id,
                    &[*promise, *reaction],
                    "promise reaction/thenable",
                );
            }
            OpKind::Retain(_)
            | OpKind::Release(_)
            | OpKind::CellReady { .. }
            | OpKind::Length(_)
            | OpKind::StringUnitAt { .. }
            | OpKind::InstanceOf { .. }
            | OpKind::TagOf { .. }
            | OpKind::OptionalDefined(_) => {
                self.graph
                    .payload(into, ValueFact::Unknown(Unknown::NotAnalysed));
            }
            // Implicit calls must already be explicit HIR calls. Any operation
            // not covered here that can touch references is an opaque effect,
            // including a future implicit-call representation we do not know.
            _ => {
                let args: Vec<_> = verify::operands(&op.kind)
                    .into_iter()
                    .filter(|arg| function.value(*arg).ty.may_hold_a_reference())
                    .collect();
                if op.ty.may_hold_a_reference() || !args.is_empty() {
                    self.opaque(context, id, &args, "unsupported reference operation");
                } else {
                    self.graph
                        .payload(into, ValueFact::Unknown(Unknown::NotAnalysed));
                }
            }
        }
        self.graph.event = None;
    }

    fn call(
        &mut self,
        context: usize,
        id: ValueId,
        callee: &Callee,
        args: &[ValueId],
        repeated: bool,
    ) {
        // Charge fan-out before copying it. Once facts are invalidated, body
        // inventory still runs, but a known dispatch cannot keep expanding.
        let targets = match callee {
            Callee::Direct(name) => usize::from(self.by_name.contains_key(name.as_str())),
            Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
                self.targets.get(slot).map_or(0, Vec::len)
            }
            Callee::External(_) | Callee::Native(_) => 0,
        };
        if targets != 0 {
            if self.graph.failure.is_some() {
                return;
            }
            if targets > self.graph.work_limit.saturating_sub(self.graph.work) {
                self.graph.failure = Some(Reason::WorkBudget);
                return;
            }
            self.graph.work += targets;
        }
        let targets = match callee {
            Callee::Direct(name) => self
                .by_name
                .get(name.as_str())
                .copied()
                .into_iter()
                .collect(),
            Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
                self.targets.get(slot).cloned().unwrap_or_default()
            }
            Callee::External(name) => {
                self.helper(context, id, name, args, repeated);
                return;
            }
            Callee::Native(_) => Vec::new(),
        };
        if targets.is_empty() {
            self.opaque(context, id, args, "unresolved call target");
            return;
        }
        for target in targets {
            if self.program.funcs[target].abstract_declaration
                || self.program.funcs[target].blocks.is_empty()
            {
                self.opaque(context, id, args, "call body unavailable");
                continue;
            }
            if let Some(summary) = self.summaries[target].clone()
                && summary
                    .parameters
                    .iter()
                    .all(|slot| args.get(*slot as usize).is_some())
            {
                self.summary_used[target] = true;
                self.apply_summary(context, id, args, &summary);
                continue;
            }
            let child = self.context(target, Some(context), Some(id));
            self.calls.push((context, child, id));
            let parameters = self.parameters[target].clone();
            for (parameter, slot) in parameters {
                if let Some(arg) = args.get(slot as usize) {
                    self.graph
                        .copy(self.value(context, *arg), self.value(child, parameter));
                } else {
                    let value = self.value(child, parameter);
                    self.outside(
                        child,
                        value,
                        format!("{}:missing-parameter:{slot}", self.contexts[child].key),
                    );
                }
            }
            self.graph
                .copy(self.contexts[child].result, self.value(context, id));
        }
    }

    fn apply_summary(&mut self, context: usize, id: ValueId, args: &[ValueId], summary: &Summary) {
        let args: Vec<_> = args.iter().map(|arg| self.value(context, *arg)).collect();
        let into = self.value(context, id);
        summary.instantiate(&mut self.graph, &args, into);
        for field in &summary.writes {
            self.contexts[context].effects.writes.insert(field.clone());
        }
    }

    #[allow(clippy::too_many_lines)]
    fn helper(
        &mut self,
        context: usize,
        id: ValueId,
        name: &str,
        args: &[ValueId],
        repeated: bool,
    ) {
        use regions::Helper;
        let into = self.value(context, id);
        let op = self.program.funcs[self.contexts[context].function].value(id);
        let argument = |slot: usize| args.get(slot).copied();
        let projection = match name {
            "nts_map_get" | "nts_map_value_at" => Some(Slot::Values),
            "nts_map_key_at" => Some(Slot::Keys),
            "nts_array_at"
            | "nts_array_at_ref"
            | "nts_array_at_value"
            | "nts_array_element"
            | "nts_array_pop"
            | "nts_array_shift"
            | "nts_array_shift_ref"
            | "nts_array_shift_value" => Some(Slot::Elements),
            _ => None,
        };
        if let (Some(slot), Some(base)) = (projection, argument(0)) {
            self.graph.load(self.value(context, base), slot, into);
            self.graph.payload(into, ValueFact::undefined());
            if name.contains("pop") || name.contains("shift") {
                self.contexts[context].effects.length = true;
            }
            return;
        }
        match regions::helper(name) {
            Some(Helper::Makes | Helper::MakesOrRetains { .. } | Helper::Copies { .. }) => {
                self.allocation(context, id, Storage::CallResult, repeated);
                if let Some(Helper::MakesOrRetains { from }) = regions::helper(name)
                    && let Some(arg) = argument(from)
                {
                    self.graph.copy(self.value(context, arg), into);
                }
                if let Some(Helper::Copies { from }) = regions::helper(name)
                    && let Some(arg) = argument(from)
                {
                    let read = self.graph.node();
                    self.graph
                        .load(self.value(context, arg), Slot::Elements, read);
                    self.graph.store(into, Slot::Elements, read);
                }
                // Helper freshness does not imply a particular returned tag.
                self.graph
                    .payload(into, ValueFact::Unknown(Unknown::NotAnalysed));
            }
            Some(Helper::Fills { into: owner }) => {
                let Some(base) = argument(owner) else {
                    self.opaque(context, id, args, "helper arity");
                    return;
                };
                if name == "nts_map_set" && args.len() >= 3 {
                    self.graph.store(
                        self.value(context, base),
                        Slot::Keys,
                        self.value(context, args[1]),
                    );
                    self.graph.store(
                        self.value(context, base),
                        Slot::Values,
                        self.value(context, args[2]),
                    );
                } else {
                    for (slot, arg) in args.iter().enumerate().filter(|(slot, _)| *slot != owner) {
                        let _ = slot;
                        self.graph.store(
                            self.value(context, base),
                            Slot::Elements,
                            self.value(context, *arg),
                        );
                    }
                }
                self.contexts[context]
                    .effects
                    .writes
                    .insert("elements".to_owned());
                self.contexts[context].effects.length = true;
                self.backing(context, id, Some(base));
                if op.ty.may_hold_a_reference() {
                    // Replacement-returning fillers need their full contract;
                    // returning only the old container would lose an origin.
                    self.graph.copy(self.value(context, base), into);
                    self.allocation(context, id, Storage::CallResult, repeated);
                }
            }
            Some(Helper::Grows { into: owner }) => {
                self.contexts[context].effects.length = true;
                self.contexts[context]
                    .effects
                    .writes
                    .insert("length/backing".to_owned());
                if let Some(base) = argument(owner) {
                    if op.ty.may_hold_a_reference() {
                        self.graph.copy(self.value(context, base), into);
                        self.allocation(context, id, Storage::CallResult, repeated);
                    }
                    self.backing(context, id, Some(base));
                }
                self.graph
                    .payload(into, ValueFact::Unknown(Unknown::NotAnalysed));
            }
            Some(Helper::Reads) if !op.ty.may_hold_a_reference() => {
                self.graph
                    .payload(into, ValueFact::Unknown(Unknown::NotAnalysed));
            }
            Some(Helper::Raises) => self.opaque(context, id, args, "raised value"),
            _ => self.opaque(context, id, args, name),
        }
    }

    fn backing(&mut self, context: usize, id: ValueId, base: Option<ValueId>) {
        let storage = self.graph.node();
        let site = self.allocations.len();
        let object = self.graph.object(
            ObjectInfo {
                label: format!("{}:%{}:backing", self.contexts[context].key, id.0),
                site: Some(site),
                context,
                instance: Instance::Summary,
                open: false,
            },
            storage,
        );
        self.allocations.push(Allocation {
            id: SiteId {
                function: self.program.funcs[self.contexts[context].function]
                    .name
                    .clone(),
                value: id.0,
                storage: Storage::CallStorage,
            },
            context,
            object,
            repeated: true,
            fallback: self.contexts[context].fallback,
        });
        if let Some(base) = base {
            self.graph
                .store(self.value(context, base), Slot::Backing, storage);
        } else {
            self.roots.push((
                storage,
                Exposure::Outside("unproved call storage effects".to_owned()),
            ));
        }
    }

    fn effects(&mut self) {
        let mut callers = vec![BTreeSet::new(); self.contexts.len()];
        for &(caller, callee, _) in &self.calls {
            callers[callee].insert(caller);
        }
        let mut pending: BTreeSet<_> = (0..self.contexts.len()).collect();
        while let Some(child) = pending.pop_first() {
            for &parent in &callers[child] {
                if !self.graph.charge() {
                    return;
                }
                if parent == child {
                    continue;
                }
                let (parent_effects, child_effects) = if parent < child {
                    let (before, after) = self.contexts.split_at_mut(child);
                    (&mut before[parent].effects, &after[0].effects)
                } else {
                    let (before, after) = self.contexts.split_at_mut(parent);
                    (&mut after[0].effects, &before[child].effects)
                };
                let Some(changed) = parent_effects.absorb(child_effects, &mut self.graph) else {
                    return;
                };
                if changed {
                    pending.insert(parent);
                }
            }
        }
    }

    /// The shared liveness authority runs once per affected function, not
    /// once per call/context. Walk backward so operands whose final read is
    /// the failing operation are included; an output does not yet exist.
    fn outcome_fences(&mut self) -> Vec<Outcome> {
        let program = self.program;
        let mut reports = Vec::new();
        for (function_index, function) in program.funcs.iter().enumerate() {
            if self.cycles[function_index].is_err() {
                continue;
            }
            let unsealed: BTreeMap<_, _> = function
                .blocks
                .iter()
                .flat_map(|block| &block.ops)
                .filter_map(|id| {
                    outcomes::unsealed(function.value(*id), &self.by_name, &self.raises)
                        .map(|reason| (*id, reason))
                })
                .collect();
            if unsealed.is_empty() {
                continue;
            }
            let live = match super::super::liveness::analyze_limited(function, &mut |units| {
                self.graph.charge_many(units)
            }) {
                Ok(live) => live,
                Err(failure) => {
                    let _ = failure.for_optional();
                    self.graph.failure.get_or_insert(Reason::WorkBudget);
                    break;
                }
            };
            for context in 0..self.contexts.len() {
                self.context_membership_visits += 1;
                if self.contexts[context].function != function_index {
                    continue;
                }
                for (block_index, block) in function.blocks.iter().enumerate() {
                    let block_id = BlockId(u32::try_from(block_index).unwrap_or(u32::MAX));
                    let mut before: BTreeSet<_> = live
                        .live_out(block_id)
                        .iter()
                        .copied()
                        .chain(super::super::operands_of_terminator(&block.terminator))
                        .filter(|id| function.value(*id).ty.may_hold_a_reference())
                        .collect();
                    for &id in block.ops.iter().rev() {
                        before.remove(&id);
                        for operand in verify::operands(&function.value(id).kind) {
                            if function.value(operand).ty.may_hold_a_reference() {
                                before.insert(operand);
                            }
                        }
                        let Some(reason) = unsealed.get(&id) else {
                            continue;
                        };
                        if !self.graph.charge_many(before.len().saturating_add(1)) {
                            return reports;
                        }
                        let root = self.graph.node();
                        for &value in &before {
                            self.graph.copy(self.value(context, value), root);
                        }
                        let payload = self.graph.node();
                        let payload_label = format!(
                            "{}:%{}:unknown-raised-payload",
                            self.contexts[context].key, id.0
                        );
                        self.outside(context, payload, payload_label.clone());
                        self.graph.copy(payload, root);
                        let witness = format!("{}:%{}: {reason}", self.contexts[context].key, id.0);
                        self.roots
                            .push((root, Exposure::Unknown(Reason::MissingOutcome(witness))));
                        reports.push(Outcome {
                            function: function.name.clone(),
                            context: self.contexts[context].key.clone(),
                            value: id.0,
                            reason: reason.clone(),
                            live: before.iter().map(|value| value.0).collect(),
                            payload: payload_label,
                        });
                    }
                }
            }
        }
        self.graph.solve();
        reports.sort_by(|a, b| {
            (&a.function, &a.context, a.value).cmp(&(&b.function, &b.context, b.value))
        });
        reports
    }

    /// Order the same writes recorded by Graph::store, including summary and
    /// helper stores. This constructs no second alias or writer analysis.
    #[expect(
        clippy::too_many_lines,
        reason = "one shared event-index construction and query detachment"
    )]
    fn store_order(
        &mut self,
        lifetimes: &lifetime::Result,
    ) -> (Vec<CaptureWrite>, Vec<usize>, usize) {
        use super::events::{Events, LaterWrite, Origin};
        let program = self.program;
        let index_cost = self
            .contexts
            .iter()
            .map(|context| {
                let function = &program.funcs[context.function];
                3 * function.blocks.len()
                    + 3 * function
                        .blocks
                        .iter()
                        .map(|block| block.ops.len())
                        .sum::<usize>()
            })
            .sum::<usize>()
            .saturating_add(self.allocations.len())
            .saturating_add(self.calls.len())
            .saturating_add(3 * self.graph.stores.len());
        if !self.graph.charge_many(index_cost) {
            return (Vec::new(), Vec::new(), 0);
        }
        let mut allocation_origins: BTreeMap<Origin, Vec<Object>> = BTreeMap::new();
        for allocation in &self.allocations {
            if allocation.id.storage != Storage::CallStorage {
                allocation_origins
                    .entry(Origin {
                        context: allocation.context,
                        value: ValueId(allocation.id.value),
                    })
                    .or_default()
                    .push(allocation.object);
            }
        }
        let mut events = Events::default();
        let entries: Vec<Vec<_>> = self
            .contexts
            .iter()
            .map(|context| {
                program.funcs[context.function]
                    .blocks
                    .iter()
                    .map(|_| events.node())
                    .collect()
            })
            .collect();
        let exits: Vec<_> = self.contexts.iter().map(|_| events.node()).collect();
        let mut points = BTreeMap::new();
        let mut links: BTreeMap<Origin, BTreeSet<usize>> = BTreeMap::new();
        for &(parent, child, value) in &self.calls {
            links
                .entry(Origin {
                    context: parent,
                    value,
                })
                .or_default()
                .insert(child);
        }
        let store_origins: BTreeSet<_> =
            self.graph.stores.iter().map(|store| store.origin).collect();
        let mut context_unknown = BTreeMap::new();
        for (context, info) in self.contexts.iter().enumerate() {
            let function = &program.funcs[info.function];
            let Ok(cycle) = &self.cycles[info.function] else {
                continue;
            };
            for (block_index, block) in function.blocks.iter().enumerate() {
                let mut cursor = entries[context][block_index];
                for &id in &block.ops {
                    let op = function.value(id);
                    let origin = Origin { context, value: id };
                    let unsealed = outcomes::unsealed(op, &self.by_name, &self.raises)
                        .map(Reason::MissingOutcome)
                        .or_else(|| self.graph.unknown_events.get(&origin).cloned());
                    if let Some(reason) = &unsealed {
                        context_unknown
                            .entry(context)
                            .or_insert_with(|| reason.clone());
                    }
                    let allocations: Vec<_> =
                        if matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }) {
                            allocation_origins.get(&origin).cloned().unwrap_or_default()
                        } else {
                            Vec::new()
                        };
                    if !store_origins.contains(&origin)
                        && unsealed.is_none()
                        && allocations.is_empty()
                        && !matches!(op.kind, OpKind::Call { .. })
                    {
                        continue;
                    }
                    if !self.graph.charge() {
                        break;
                    }
                    let at = events.node();
                    events.edge(cursor, at, &mut self.graph);
                    if let Some(reason) = unsealed {
                        events.unknown(at, reason);
                    }
                    for object in allocations {
                        events.fresh(at, object);
                    }
                    let after = if matches!(op.kind, OpKind::Call { .. }) {
                        let after = events.node();
                        if let Some(children) = links.get(&origin) {
                            for &child in children {
                                if let Some(entry) = entries[child].first() {
                                    events.edge(at, *entry, &mut self.graph);
                                    events.edge(exits[child], after, &mut self.graph);
                                } else {
                                    events.unknown(at, Reason::ProducerUnproved);
                                }
                            }
                        } else {
                            events.edge(at, after, &mut self.graph);
                        }
                        after
                    } else {
                        at
                    };
                    points.insert(origin, after);
                    cursor = after;
                }
                let block_id = BlockId(u32::try_from(block_index).unwrap_or(u32::MAX));
                if let Some(successors) = cycle.successors(block_id) {
                    for target in successors {
                        events.edge(cursor, entries[context][target.0 as usize], &mut self.graph);
                    }
                }
                if matches!(block.terminator, Terminator::Return(_)) {
                    events.edge(cursor, exits[context], &mut self.graph);
                }
            }
        }
        for store in &self.graph.stores {
            let Some(&at) = points.get(&store.origin) else {
                continue;
            };
            if self.graph.values[store.base].objects.is_empty() {
                events.unknown(
                    at,
                    Reason::BindingIdentityUnproved(
                        "store base has no proved allocation identity".to_owned(),
                    ),
                );
            }
            for &object in &self.graph.values[store.base].objects {
                events.write(at, (object, store.slot.clone()));
            }
        }
        events.solve(&mut self.graph);
        let mut captures = Vec::new();
        for store in &self.graph.stores {
            let info = &self.contexts[store.origin.context];
            let function = &program.funcs[info.function];
            let op = function.value(store.origin.value);
            let OpKind::FieldSet {
                object: environment,
                value: binding,
                ..
            } = &op.kind
            else {
                continue;
            };
            let HirType::Managed(ManagedType::Object(environment_ty)) =
                &function.value(*environment).ty
            else {
                continue;
            };
            if !super::super::is_closure_type(*environment_ty) {
                continue;
            }
            let HirType::Managed(ManagedType::Object(binding_ty)) = &function.value(*binding).ty
            else {
                continue;
            };
            if !(super::super::SYNTHETIC_CELLS..super::super::SYNTHETIC_OBJC_STATES)
                .contains(&binding_ty.0)
            {
                continue;
            }
            let Some(layout) = self.layouts.get(binding_ty).map(|at| &program.layouts[*at]) else {
                continue;
            };
            let Some(slot_index) = layout
                .fields
                .iter()
                .position(|field| field.name == super::super::PropertyKey::from("value"))
            else {
                continue;
            };
            let Some(slot) = self.field(
                &function.value(*binding).ty,
                u32::try_from(slot_index).unwrap_or(u32::MAX),
            ) else {
                continue;
            };
            let origin = store.origin;
            let Some(&event) = points.get(&origin) else {
                continue;
            };
            let direct = matches!(function.value(*binding).kind, OpKind::ObjectNew { .. });
            let object = allocation_origins
                .get(&Origin {
                    context: origin.context,
                    value: *binding,
                })
                .and_then(|objects| objects.first())
                .copied();
            let later_write = if let Some(failure) = &self.graph.failure {
                LaterWrite::Unknown(failure.clone())
            } else if let Some(reason) = context_unknown.get(&origin.context) {
                LaterWrite::Unknown(reason.clone())
            } else if !direct || info.fallback || object.is_none() {
                LaterWrite::Unknown(Reason::BindingIdentityUnproved(
                    "capture has no direct fresh binding instance".to_owned(),
                ))
            } else if let Some(object) = object {
                let ordered = events.query(event, &(object, slot.clone()), &self.graph);
                if matches!(ordered, LaterWrite::ProvedNone { .. }) {
                    let escapes = self.graph.values[store.base].objects.iter().any(|environment|
                        !matches!(lifetimes.bounds[*environment], Bound::Frame(owner) if owner == origin.context));
                    if self.graph.is_widened(object) || self.graph.objects[object].open {
                        LaterWrite::Unknown(Reason::BindingIdentityUnproved(
                            "binding has merged or open writers".to_owned(),
                        ))
                    } else if escapes {
                        LaterWrite::Unknown(Reason::RetainedEnvironment(
                            "retained callback entry writer authority is not sealed".to_owned(),
                        ))
                    } else {
                        ordered
                    }
                } else {
                    ordered
                }
            } else {
                unreachable!()
            };
            captures.push(CaptureWrite {
                function: function.name.clone(),
                context: info.key.clone(),
                capture: origin.value.0,
                binding: object.map_or_else(
                    || format!("%{}", binding.0),
                    |object| self.graph.label(object),
                ),
                slot: format!("{slot:?}"),
                later_write,
            });
        }
        captures.sort_by(|a, b| {
            (&a.function, &a.context, a.capture, &a.binding).cmp(&(
                &b.function,
                &b.context,
                b.capture,
                &b.binding,
            ))
        });
        (captures, events.changes().to_vec(), events.len())
    }

    fn frontiers(&mut self) -> Vec<Frontier> {
        let mut reads: BTreeMap<(usize, usize), BTreeSet<ValueId>> = BTreeMap::new();
        'index: for (parent, context) in self.contexts.iter().enumerate() {
            let function = &self.program.funcs[context.function];
            for &value in function.blocks.iter().flat_map(|block| &block.ops) {
                let objects: Vec<_> = self.graph.values[context.values[&value]]
                    .objects
                    .iter()
                    .copied()
                    .collect();
                for object in objects {
                    if self.graph.is_widened(object) {
                        // A shared weak class supplies no caller-specific
                        // last-use frontier. Its members remain Heap.
                        continue;
                    }
                    let source = self.graph.objects[object].context;
                    for &owner in self.contexts[source]
                        .ancestors
                        .iter()
                        .chain(std::iter::once(&source))
                    {
                        if !self.graph.charge() {
                            break 'index;
                        }
                        if self.contexts[owner].parent == Some(parent)
                            && !self.contexts[owner].fallback
                        {
                            reads.entry((parent, owner)).or_default().insert(value);
                        }
                    }
                }
            }
        }
        let mut flows = BTreeMap::new();
        let mut frontiers = Vec::new();
        for ((parent, child), values) in reads {
            let Some(call) = self.contexts[child].call else {
                continue;
            };
            let function_index = self.contexts[parent].function;
            let function = &self.program.funcs[function_index];
            let owner = format!("{}:%{}", self.contexts[parent].key, call.0);
            // Charge the worst scan the shared frontier query can perform
            // before invoking it; do not hide a calls-times-blocks blow-up.
            let cost = function
                .blocks
                .len()
                .saturating_mul(values.len().saturating_add(1));
            if cost > self.graph.work_limit.saturating_sub(self.graph.work) {
                self.graph.failure.get_or_insert(Reason::WorkBudget);
                frontiers.push(Frontier {
                    owner,
                    ends: Err("frontier work budget".to_owned()),
                });
                break;
            }
            self.graph.work += cost;
            let flow = flows.entry(function_index).or_insert_with(|| {
                regions::Flow::of(function).map_err(|failure| failure.to_string())
            });
            let ends = flow.as_ref().map_err(Clone::clone).and_then(|flow| {
                let values: Vec<_> = values.into_iter().collect();
                flow.holds(call, &values)
                    .map(|holds| {
                        holds
                            .into_iter()
                            .map(|hold| match hold {
                                regions::Hold::After(block) => {
                                    format!("after last reference use in block {block}")
                                }
                                regions::Hold::OnEntry(block) => format!("entry of block {block}"),
                            })
                            .collect()
                    })
                    .map_err(str::to_owned)
            });
            frontiers.push(Frontier { owner, ends });
        }
        frontiers.sort_by(|a, b| a.owner.cmp(&b.owner));
        frontiers
    }

    #[expect(
        clippy::too_many_lines,
        reason = "one detachment of the solved graph into canonical diagnostic tables"
    )]
    fn finish(mut self) -> Report {
        let outcome_start = self.graph.work;
        let outcomes = self.outcome_fences();
        self.stages
            .push(("outcome-fences".to_owned(), self.graph.work - outcome_start));
        let exposure_start = self.graph.work;
        let hierarchy: Vec<_> = self
            .contexts
            .iter()
            .map(|context| lifetime::Context {
                parent: context.parent,
                ancestors: &context.ancestors,
                key: &context.key,
                fallback: context.fallback,
            })
            .collect();
        let lifetimes = lifetime::analyze(&mut self.graph, &hierarchy, &self.roots);
        let mut site_reasons = vec![BTreeSet::new(); self.allocations.len()];
        let mut site_witnesses = vec![Vec::new(); self.allocations.len()];
        for (object, info) in self.graph.objects.iter().enumerate() {
            if let Some(site) = info.site {
                let reason = match &lifetimes.bounds[object] {
                    Bound::Frame(context) if *context == info.context => None,
                    Bound::Frame(context) => {
                        Some(Reason::OutlivesFrame(self.contexts[*context].key.clone()))
                    }
                    Bound::Outside(reason) => Some(reason.clone()),
                };
                site_reasons[site].extend(reason);
                site_witnesses[site].push(format!("proof {}", lifetimes.witnesses[object]));
            }
        }
        self.stages
            .push(("exposure".to_owned(), self.graph.work - exposure_start));
        let start = self.graph.work;
        let frontiers = self.frontiers();
        self.stages
            .push(("frontiers".to_owned(), self.graph.work - start));
        let start = self.graph.work;
        let (captures, event_changes, memory_events) = self.store_order(&lifetimes);
        self.stages
            .push(("store-order".to_owned(), self.graph.work - start));
        let unknown = ValueFact::Unknown(Unknown::NotAnalysed);
        let payload = |node: Node| {
            if self.graph.failure.is_some() {
                ValueFact::Unknown(Unknown::Budget)
            } else {
                self.graph.values[node].payload.unwrap_or(unknown)
            }
        };
        let aliases = |node: Node| {
            if self.graph.failure.is_some() {
                return vec!["unknown:budget".to_owned()];
            }
            let mut aliases: Vec<_> = self.graph.values[node]
                .objects
                .iter()
                .map(|object| self.graph.label(*object))
                .collect();
            aliases.sort();
            aliases.dedup();
            aliases
        };
        let mut sites = Vec::new();
        let mut retention_sites: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (index, allocation) in self.allocations.iter().enumerate() {
            let context = &self.contexts[allocation.context];
            let mut reasons = site_reasons[index].clone();
            let witnesses = site_witnesses[index].clone();
            debug_assert_eq!(self.graph.objects[allocation.object].site, Some(index));
            if allocation.fallback {
                reasons.insert(Reason::ContextBudget);
            }
            if allocation.repeated {
                reasons.insert(Reason::RepeatedInstances);
            }
            if allocation.id.storage != Storage::Object {
                reasons.insert(Reason::StorageBoundUnproved);
            }
            if allocation.id.storage == Storage::Native {
                reasons.insert(Reason::ManualStorage);
            }
            let home = if let Some(failure) = &self.graph.failure {
                Home::Heap(failure.clone())
            } else {
                reasons.first().cloned().map_or(Home::Frame, Home::Heap)
            };
            let candidate_owner = context
                .parent
                .zip(context.call)
                .filter(|_| !context.fallback)
                .map(|(parent, call)| format!("{}:%{}", self.contexts[parent].key, call.0));
            let retention_frontier = match &lifetimes.bounds[allocation.object] {
                Bound::Frame(owner) => format!("frame {}", self.contexts[*owner].key),
                Bound::Outside(reason) => format!("unknown frontier: {reason:?}"),
            };
            retention_sites
                .entry(retention_frontier.clone())
                .or_default()
                .insert(format!(
                    "{}:%{}:{:?}",
                    context.key, allocation.id.value, allocation.id.storage
                ));
            let bytes_held_to_frontier = RetainedBytes::Unknown {
                witness: if allocation.repeated {
                    "no finite live-instance bound; backing and held heap graphs remain included"
                        .to_owned()
                } else {
                    "no sealed target/runtime allocation-footprint witness at this HIR boundary; backing and held heap graphs remain included".to_owned()
                },
            };
            sites.push(Site {
                id: allocation.id.clone(),
                origin: self.program.funcs[context.function]
                    .value(ValueId(allocation.id.value))
                    .origin
                    .clone(),
                context: context.key.clone(),
                multiplicity: if allocation.repeated {
                    Multiplicity::Unbounded { witness: format!(
                        "{}:%{}: loop, recursive/reentrant/suspended or externally repeated activation; older instance retained",
                        context.key, allocation.id.value) }
                } else {
                    Multiplicity::One { witness: format!(
                        "{}:%{}: acyclic placed producer in a unique nonreentrant activation",
                        context.key, allocation.id.value) }
                },
                retention_frontier,
                bytes_held_to_frontier,
                home,
                obligations: reasons.into_iter().collect(),
                candidate_owner,
                witness: witnesses,
                legacy: Vec::new(),
            });
        }
        sites.sort_by(|a, b| (&a.id, &a.context).cmp(&(&b.id, &b.context)));
        let mut values = Vec::new();
        let mut functions = Vec::new();
        for context in &self.contexts {
            let function = &self.program.funcs[context.function];
            for block in &function.blocks {
                for &id in block.params.iter().chain(&block.ops) {
                    let node = context.values[&id];
                    values.push(Value {
                        function: function.name.clone(),
                        context: context.key.clone(),
                        value: id.0,
                        aliases: aliases(node),
                        payload: payload(node),
                    });
                }
            }
            functions.push(FunctionSummary {
                function: function.name.clone(),
                context: context.key.clone(),
                returned: aliases(context.result),
                writes: context.effects.writes.iter().cloned().collect(),
                stores: Vec::new(),
                may_change_length: context.effects.length || self.graph.failure.is_some(),
                may_suspend: context.effects.suspension || self.graph.failure.is_some(),
                may_reenter: context.effects.reentrant || self.graph.failure.is_some(),
                unknown_effects: context.effects.unknown || self.graph.failure.is_some(),
            });
        }
        for (at, summary) in self
            .summaries
            .iter()
            .enumerate()
            .filter_map(|(at, summary)| {
                summary
                    .as_ref()
                    .filter(|_| self.summary_used[at])
                    .map(|summary| (at, summary))
            })
        {
            functions.push(FunctionSummary {
                function: self.program.funcs[at].name.clone(),
                context: "parametric".to_owned(),
                returned: summary.result.clone(),
                writes: summary.writes.clone(),
                stores: summary.stores.clone(),
                may_change_length: self.graph.failure.is_some(),
                may_suspend: self.graph.failure.is_some(),
                may_reenter: self.graph.failure.is_some(),
                unknown_effects: self.graph.failure.is_some(),
            });
        }
        values.sort_by(|a, b| {
            (&a.function, &a.context, a.value).cmp(&(&b.function, &b.context, b.value))
        });
        functions.sort_by(|a, b| (&a.function, &a.context).cmp(&(&b.function, &b.context)));
        let mut slots: Vec<_> = self
            .graph
            .slots
            .iter()
            .map(|((object, slot), node)| SlotFact {
                owner: self.graph.label(*object),
                context: self.contexts[self.graph.objects[*object].context]
                    .key
                    .clone(),
                instance: format!("{:?}", self.graph.objects[*object].instance),
                slot: format!("{slot:?}"),
                aliases: aliases(*node),
                payload: payload(*node),
            })
            .collect();
        slots.sort_by(|a, b| (&a.owner, &a.slot).cmp(&(&b.owner, &b.slot)));
        let store_versions = self
            .graph
            .stores
            .iter()
            .map(|store| {
                let context = &self.contexts[store.origin.context];
                StoreVersion {
                    function: self.program.funcs[context.function].name.clone(),
                    context: context.key.clone(),
                    value: store.origin.value.0,
                    version: store.version,
                    aliases: aliases(store.version),
                    payload: payload(store.version),
                    slot: format!("{:?}", store.slot),
                }
            })
            .collect();
        let retentions = retention_sites.into_iter().map(|(frontier,sites)| Retention {
            frontier, sites: sites.into_iter().collect(),
            bytes: RetainedBytes::Unknown { witness: "complete target footprint, live-instance and held-graph bound is not sealed".to_owned() },
        }).collect();
        Report {
            sites,
            values,
            slots,
            functions,
            frontiers,
            outcomes,
            captures,
            store_versions,
            retentions,
            event_changes,
            memory_events,
            context_membership_visits: self.context_membership_visits,
            proofs: lifetimes.proofs,
            alias_classes: self.graph.classes(),
            operations: self.operations,
            contexts: self.contexts.len(),
            nodes: self.graph.values.len(),
            work: self.graph.work,
            work_limit: self.graph.work_limit,
            edges: self.graph.edges,
            edge_limit: self.graph.edge_limit,
            failure: self.graph.failure,
            stages: self.stages,
            state_changes: self
                .graph
                .values
                .iter()
                .map(|value| value.changes)
                .collect(),
            state_change_limit: self.graph.alias_limit.max(1).saturating_add(1),
        }
    }
}
