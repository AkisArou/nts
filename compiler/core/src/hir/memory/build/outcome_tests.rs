//! Nonlocal transfer must fence payloads, their children and independent live roots.

use super::tests::{function, origin};
use super::*;
use crate::hir::{
    Absent, Field, Layout, Op, Param, ParamShape, SYNTHETIC_CELLS, SYNTHETIC_CLOSURES, TypeId,
    memory,
};

fn transfer_program(transfers: bool) -> Program {
    let cell_id = TypeId(SYNTHETIC_CELLS);
    let env_id = TypeId(SYNTHETIC_CLOSURES);
    let child_id = TypeId(7);
    let cell = HirType::Managed(ManagedType::Object(cell_id));
    let env = HirType::Managed(ManagedType::Object(env_id));
    let child = HirType::Managed(ManagedType::Object(child_id));
    let mut caller = function(
        "root#init".into(),
        vec![
            OpKind::ObjectNew { frame: false },
            OpKind::ObjectNew { frame: false },
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
            OpKind::ObjectNew { frame: false },
            OpKind::Erase {
                value: ValueId(0),
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            OpKind::Call {
                callee: Callee::Direct("ordinary".into()),
                args: vec![ValueId(6)],
                frame: None,
            },
            OpKind::Retain(ValueId(5)),
        ],
    );
    for (at, ty) in [
        (0, cell.clone()),
        (1, child.clone()),
        (3, env),
        (5, child.clone()),
        (6, HirType::Erased),
    ] {
        caller.values[at].ty = ty;
    }
    let mut ordinary = function(
        "ordinary".into(),
        vec![OpKind::Param(0), OpKind::ConstString("detail".into())],
    );
    ordinary.params = vec![Param {
        name: "payload".into(),
        ty: HirType::Erased,
        origin: origin(),
        shape: ParamShape::Ordinary,
        known: facts::Facts::TOP,
        written: None,
    }];
    ordinary.values[0].ty = HirType::Erased;
    ordinary.values[1].ty = HirType::Managed(ManagedType::String);
    if transfers {
        ordinary.values.push(Op {
            kind: OpKind::Call {
                callee: Callee::External("nts_uncaught".into()),
                args: vec![ValueId(0), ValueId(1)],
                frame: None,
            },
            ty: HirType::Void,
            origin: origin(),
        });
        ordinary.blocks[0].ops.push(ValueId(2));
        ordinary.blocks[0].terminator = Terminator::Unreachable;
    }
    let layout = |id, name: &str, fields| Layout {
        types: vec![id],
        name: name.into(),
        fields,
        methods: Vec::new(),
        interfaces: Vec::new(),
        base: None,
    };
    let field = |name: &str, ty| Field {
        name: name.into(),
        ty,
        readonly: false,
        written: None,
        declared_by: None,
    };
    Program {
        funcs: vec![caller, ordinary],
        layouts: vec![
            layout(cell_id, "binding", vec![field("value", child)]),
            layout(env_id, "environment", vec![field("captured", cell)]),
            layout(child_id, "child", Vec::new()),
        ],
        ..Program::default()
    }
}

fn check_transfer(transfers: bool) {
    let program = transfer_program(transfers);
    let analysis = memory::Analysis::of(&program);
    let report = analysis.report();
    assert!(report.failure.is_none(), "{:?}", report.failure);
    for value in [0, 1, 5] {
        let site = report
            .sites
            .iter()
            .find(|site| site.id.function == "root#init" && site.id.value == value)
            .expect("complete allocation inventory");
        println!(
            "transfer-root\ttransfers={transfers}\tvalue={value}\thome={:?}\tfrontier={}\twitness={:?}",
            site.home, site.retention_frontier, site.witness
        );
        if transfers {
            assert!(matches!(site.home, Home::Heap(_)), "{site:?}");
            assert!(
                site.obligations
                    .iter()
                    .any(|reason| matches!(reason, Reason::MissingOutcome(_))),
                "{site:?}"
            );
            assert!(site.retention_frontier.contains("MissingOutcome"));
            for witness in &site.witness {
                let id: usize = witness
                    .strip_prefix("proof ")
                    .expect("proof reference")
                    .parse()
                    .expect("proof ID");
                assert!(report.proofs[id].bound.contains("MissingOutcome"));
            }
        } else {
            assert_eq!(site.home, Home::Frame);
        }
    }
    assert_eq!(report.captures.len(), 1);
    let capture = &report.captures[0];
    println!("transfer-capture\ttransfers={transfers}\t{capture:?}");
    if transfers {
        assert!(matches!(
            capture.later_write,
            memory::LaterWrite::Unknown(Reason::MissingOutcome(_))
        ));
        let fence = report
            .outcomes
            .iter()
            .find(|outcome| outcome.function == "root#init" && outcome.value == 7)
            .expect("transitive transfer fence");
        assert!(fence.live.contains(&5));
        assert!(fence.live.contains(&6));
        assert!(
            !fence.live.contains(&1),
            "the child is reached through the payload graph"
        );
    } else {
        assert!(matches!(
            capture.later_write,
            memory::LaterWrite::ProvedNone { .. }
        ));
        assert!(report.outcomes.is_empty());
    }
}

#[test]
fn uncaught_transfer_roots_payload_children_live_values_and_capture_order() {
    check_transfer(true);
}

#[test]
fn closed_body_no_raise_keeps_the_same_roots_confined() {
    check_transfer(false);
}

fn raw_loan_program(transfers: bool, through_block_loop: bool) -> Program {
    use crate::hir::{Block, native};
    let mut program = transfer_program(transfers);
    let caller = &mut program.funcs[0];
    let string = HirType::Managed(ManagedType::String);
    let raw = native::Encoding::View.c_type().representation();
    caller.values.extend([
        Op {
            kind: OpKind::ConstString("left".into()),
            ty: string.clone(),
            origin: origin(),
        },
        Op {
            kind: OpKind::ConstString("right".into()),
            ty: string.clone(),
            origin: origin(),
        },
        Op {
            kind: OpKind::Call {
                callee: Callee::External("nts_concat".into()),
                args: vec![ValueId(9), ValueId(10)],
                frame: None,
            },
            ty: string,
            origin: origin(),
        },
        Op {
            kind: OpKind::Erase {
                value: ValueId(0),
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            ty: HirType::Erased,
            origin: origin(),
        },
    ]);
    // The actual licensed loan producer, not a managed FieldView given an
    // invented raw result type. The owner/held child are also the raised payload.
    caller.values[6].kind = OpKind::NativeStringView {
        string: ValueId(11),
    };
    caller.values[6].ty = raw.clone();
    let OpKind::Call { args, .. } = &mut caller.values[7].kind else {
        unreachable!()
    };
    *args = vec![ValueId(12)];
    caller.values[8].kind = OpKind::Binary {
        op: BinOp::Eq,
        lhs: ValueId(6),
        rhs: ValueId(6),
    };
    caller.values[8].ty = HirType::Bool;
    caller.return_type = HirType::Bool;
    caller.blocks[0].ops = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 12, 7, 8]
        .map(ValueId)
        .to_vec();
    caller.blocks[0].terminator = Terminator::Return(Some(ValueId(8)));
    if through_block_loop {
        caller.values.push(Op {
            kind: OpKind::BlockParam(0),
            ty: raw,
            origin: origin(),
        });
        caller.blocks[0].ops.pop();
        caller.blocks[0].terminator = Terminator::Jump {
            target: BlockId(1),
            args: vec![ValueId(6)],
        };
        caller.values[8].kind = OpKind::Binary {
            op: BinOp::Eq,
            lhs: ValueId(13),
            rhs: ValueId(13),
        };
        caller.blocks.push(Block {
            params: vec![ValueId(13)],
            ops: vec![ValueId(8)],
            terminator: Terminator::Branch {
                cond: ValueId(8),
                then_target: BlockId(1),
                then_args: vec![ValueId(13)],
                else_target: BlockId(2),
                else_args: Vec::new(),
            },
        });
        caller.blocks.push(Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(Some(ValueId(8))),
        });
    }
    program
}

#[test]
fn a_verified_string_loan_carrier_and_held_payload_survive_an_outcome() {
    for transfers in [false, true] {
        for through_block_loop in [false, true] {
            let program = raw_loan_program(transfers, through_block_loop);
            verify::verify(&program)
                .expect("the positive and control use verifier-licensed producers");
            let report = memory::Analysis::of(&program).into_report();
            assert!(report.failure.is_none(), "{:?}", report.failure);
            for value in [0, 1, 11] {
                let site = report
                    .sites
                    .iter()
                    .find(|site| site.id.function == "root#init" && site.id.value == value)
                    .expect("owner, child and loaned string inventoried");
                println!(
                    "verified-raw-carrier\ttransfers={transfers}\tloop={through_block_loop}\tvalue={value}\thome={:?}\tfrontier={}",
                    site.home, site.retention_frontier
                );
                if transfers {
                    assert!(
                        site.obligations
                            .iter()
                            .any(|reason| matches!(reason, Reason::MissingOutcome(_))),
                        "{site:?}"
                    );
                } else if value != 11 {
                    assert_eq!(site.home, Home::Frame);
                }
            }
            if transfers {
                let fence = report
                    .outcomes
                    .iter()
                    .find(|outcome| outcome.function == "root#init" && outcome.value == 7)
                    .expect("missing outcome");
                assert!(
                    fence.live.contains(&6),
                    "the licensed raw loan remains a graph carrier"
                );
            } else {
                assert!(report.outcomes.is_empty());
            }
        }
    }
}

#[test]
fn unused_invalid_view_operands_do_not_enter_the_memory_input_domain() {
    let mut panics = Vec::new();
    for bad in [false, true] {
        for field_view in [false, true] {
            let mut program = transfer_program(true);
            let body = &mut program.funcs[0];
            body.values.push(Op {
                kind: if field_view {
                    OpKind::FieldView {
                        value: ValueId(if bad { 99 } else { 0 }),
                        source: TypeId(SYNTHETIC_CELLS),
                        face: TypeId(SYNTHETIC_CELLS),
                    }
                } else {
                    OpKind::Convert(ValueId(if bad { 99 } else { 0 }))
                },
                ty: body.values[0].ty.clone(),
                origin: origin(),
            });
            let measured = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                memory::Analysis::of(&program).into_report()
            }));
            let Ok(report) = measured else {
                panics.push((bad, field_view));
                continue;
            };
            assert!(
                report.failure.is_none(),
                "unused metadata changes no executed operand domain: {:?}",
                report.failure
            );
            assert_eq!(report.sites.len(), 4);
            assert!(
                report
                    .sites
                    .iter()
                    .filter(|site| site.id.function == "root#init"
                        && [0, 1, 5].contains(&site.id.value))
                    .all(|site| site
                        .obligations
                        .iter()
                        .any(|reason| matches!(reason, Reason::MissingOutcome(_))))
            );
        }
    }
    assert!(
        panics.is_empty(),
        "unused metadata caused endpoint panics: {panics:?}"
    );
}
