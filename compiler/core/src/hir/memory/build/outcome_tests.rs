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
    ordinary.values[1].ty = HirType::STRING;
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
            assert!(
                matches!(site.home, Home::Heap(Reason::MissingOutcome(_))),
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
