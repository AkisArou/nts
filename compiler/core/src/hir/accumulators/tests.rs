use super::*;
use crate::hir::{Absent, Block, BlockId, Callee};
use nts_diagnostics::{Location, SourceId, Span};
use rustc_hash::FxHashMap;

fn origin() -> Origin {
    Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    })
}

fn value(kind: OpKind, ty: HirType) -> Op {
    Op {
        kind,
        ty,
        origin: origin(),
    }
}

fn function(left: Op, right: Op, bin: BinOp) -> Func {
    let values = vec![
        left,
        right,
        value(
            OpKind::Binary {
                op: bin,
                lhs: ValueId(0),
                rhs: ValueId(1),
            },
            F64,
        ),
        value(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: ValueId(2),
            },
            I32,
        ),
    ];
    Func {
        name: "arithmetic".to_owned(),
        params: vec![],
        return_type: I32,
        blocks: vec![Block {
            params: vec![],
            ops: (0..4).map(ValueId).collect(),
            terminator: Terminator::Return(Some(ValueId(3))),
        }],
        values,
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        async_result: None,
        frame: None,
        abstract_declaration: false,
        obligations: vec![],
        exact: FxHashMap::default(),
        written_return: None,
        result_absent: Absent::Impossible,
        written_return_elements: vec![],
    }
}

fn constant(n: f64) -> Op {
    value(OpKind::ConstFloat(n), F64)
}

fn run(func: &mut Func) -> Report {
    let mut program = Program::default();
    program.funcs.push(func.clone());
    let report = rewrite(&mut program);
    *func = program.funcs.remove(0);
    report
}

#[test]
fn exact_int32_operands_wrap_under_the_existing_integer_contract() {
    for bin in [BinOp::Add, BinOp::Sub] {
        let mut func = function(constant(f64::from(i32::MAX)), constant(1.0), bin);
        assert_eq!(run(&mut func).rewritten, 1);
        assert!(matches!(func.value(ValueId(3)).kind, OpKind::Binary { op, .. } if op == bin));
        assert_eq!(func.value(ValueId(3)).ty, I32);
        assert!(!func.blocks[0].ops.contains(&ValueId(2)));
        assert_eq!(func.blocks.len(), 1, "no guard or fallback CFG");
    }
}

#[test]
fn fractions_nonfinite_and_wide_ranges_do_not_license_the_rewrite() {
    for n in [
        0.5,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        2_147_483_648.0,
        -2_147_483_649.0,
    ] {
        let mut func = function(constant(1.0), constant(n), BinOp::Add);
        let report = run(&mut func);
        assert_eq!(report.rewritten, 0, "{n}");
        assert_eq!(report.sites[0].decision, Decision::RightUnproved);
    }
}

#[test]
fn negative_zero_is_discarded_only_at_the_truncating_sink() {
    let mut func = function(constant(-0.0), constant(0.0), BinOp::Sub);
    assert_eq!(run(&mut func).rewritten, 1);
    assert!(matches!(func.value(ValueId(0)).kind, OpKind::ConstFloat(n) if n.is_sign_negative()));
    assert_eq!(func.value(ValueId(0)).ty, F64);
}

#[test]
fn an_edge_or_an_operation_reading_the_floating_sum_keeps_it_floating() {
    for edge in [false, true] {
        let mut func = function(constant(2.0), constant(3.0), BinOp::Add);
        if edge {
            func.blocks[0].terminator = Terminator::Jump {
                target: BlockId(1),
                args: vec![ValueId(2)],
            };
            func.values.push(value(OpKind::BlockParam(0), F64));
            func.blocks.push(Block {
                params: vec![ValueId(4)],
                ops: vec![],
                terminator: Terminator::Return(Some(ValueId(3))),
            });
        } else {
            func.values.push(value(
                OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: ValueId(2),
                    rhs: ValueId(1),
                },
                F64,
            ));
            func.blocks[0].ops.push(ValueId(4));
        }
        let report = run(&mut func);
        assert_eq!(report.rewritten, 0);
        assert_eq!(report.sites[0].decision, Decision::ExtraSumUse);
    }
}

#[test]
fn repeated_call_arguments_exhaust_before_cloning_or_publishing_a_rewrite() {
    let mut func = function(constant(2.0), constant(3.0), BinOp::Add);
    func.values.push(value(
        OpKind::Call {
            callee: Callee::External("opaque".to_owned()),
            args: vec![ValueId(0); WORK],
            frame: None,
        },
        HirType::Void,
    ));
    func.blocks[0].ops.push(ValueId(4));
    let report = run(&mut func);
    assert_eq!(report.rewritten, 0);
    assert_eq!(report.sites[0].decision, Decision::Budget);
    assert_eq!(report.budget_exhaustions, 1);
}

#[test]
fn a_function_without_candidates_never_queries_content_facts() {
    let mut func = function(constant(2.0), constant(3.0), BinOp::Mul);
    let report = run(&mut func);
    assert!(report.sites.is_empty());
    assert_eq!(
        report.visits,
        func.values.len() + func.blocks.len() + func.blocks[0].ops.len()
    );
}

#[test]
fn exact_small_integer_widenings_require_explicit_i32_operands() {
    for (bits, signed, expected) in [
        (8, true, 1),
        (16, true, 1),
        (32, true, 1),
        (8, false, 1),
        (16, false, 1),
        (32, false, 0),
    ] {
        let mut func = function(
            value(OpKind::ConstInt(17), HirType::Int { bits, signed }),
            constant(1.0),
            BinOp::Add,
        );
        func.values.push(value(OpKind::Convert(ValueId(0)), F64));
        if let OpKind::Binary { lhs, .. } = &mut func.values[2].kind {
            *lhs = ValueId(4);
        }
        func.blocks[0].ops.insert(2, ValueId(4));
        assert_eq!(run(&mut func).rewritten, expected, "{bits}/{signed}");
        if let OpKind::Binary { lhs, rhs, .. } = func.values[3].kind {
            assert_eq!(func.value(lhs).ty, I32);
            assert_eq!(func.value(rhs).ty, I32);
        }
    }
}

#[test]
fn dense_sites_charge_one_linear_rebuild_and_preserve_wrapping_answers() {
    for sites in [64_usize, 128, 256] {
        let mut func = function(constant(f64::from(i32::MAX)), constant(1.0), BinOp::Add);
        func.values.truncate(2);
        for _ in 0..sites {
            let sum = ValueId(u32::try_from(func.values.len()).expect("small dense control"));
            func.values.push(value(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: ValueId(0),
                    rhs: ValueId(1),
                },
                F64,
            ));
            func.values.push(value(
                OpKind::Unary {
                    op: UnOp::ToInt32,
                    operand: sum,
                },
                I32,
            ));
        }
        let count = u32::try_from(func.values.len()).expect("small dense control");
        func.blocks[0].ops = (0..count).map(ValueId).collect();
        func.blocks[0].terminator = Terminator::Return(Some(ValueId(count - 1)));
        let report = run(&mut func);
        assert_eq!(report.rewritten, sites);
        assert_eq!(report.mutation_visits, 10 + 18 * sites);
        assert!(report.visits <= 2 * WORK);
        for id in (3..count).step_by(2) {
            let OpKind::Binary {
                op: BinOp::Add,
                lhs,
                rhs,
            } = func.value(ValueId(id)).kind
            else {
                panic!("rewritten sum");
            };
            let operand = |id| {
                let OpKind::Convert(original) = func.value(id).kind else {
                    panic!("explicit i32 conversion");
                };
                let OpKind::ConstFloat(number) = func.value(original).kind else {
                    panic!("constant control");
                };
                #[allow(clippy::cast_possible_truncation)]
                let integer = number as i32;
                integer
            };
            assert_eq!(operand(lhs).wrapping_add(operand(rhs)), i32::MIN);
        }
        let mut program = Program::default();
        program.funcs.push(func);
        super::super::verify::verify(&program).expect("dense rewritten graph");
    }
}
