use super::*;
use hir::{BinOp, BlockId};

const TAG: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

fn selected(stored: Op) -> Func {
    let mut func = fixture(stored);
    func.values.extend([
        op(OpKind::Convert(ValueId(4)), number()), // 11: exact widening
        op(OpKind::TagOf { value: ValueId(9) }, TAG), // 12
        op(OpKind::ConstInt(i128::from(hir::tags::UNDEFINED)), TAG),
        op(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: ValueId(12),
                rhs: ValueId(13),
            },
            HirType::Bool,
        ),
        op(OpKind::ConstInt(i128::from(hir::tags::NULL)), TAG),
        op(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: ValueId(12),
                rhs: ValueId(15),
            },
            HirType::Bool,
        ),
        op(
            OpKind::Binary {
                op: BinOp::BitOr,
                lhs: ValueId(14),
                rhs: ValueId(16),
            },
            HirType::Bool,
        ),
        op(OpKind::ConstFloat(0.0), number()), // 18: absent default
        op(
            OpKind::Unerase {
                value: ValueId(9),
                failure: None,
            },
            number(),
        ), // 19
        op(OpKind::BlockParam(0), number()),   // 20: selected value
    ]);
    if let OpKind::Erase { value, .. } = &mut func.values[5].kind {
        *value = ValueId(11);
    }
    func.blocks[0].ops.retain(|id| id.0 != 10);
    func.blocks[0].ops.insert(5, ValueId(11));
    func.blocks[0].ops.extend((12..18).map(ValueId));
    func.blocks[0].terminator = Terminator::Branch {
        cond: ValueId(17),
        then_target: BlockId(1),
        then_args: vec![],
        else_target: BlockId(2),
        else_args: vec![],
    };
    func.blocks.extend([
        Block {
            params: vec![],
            ops: vec![ValueId(18)],
            terminator: Terminator::Jump {
                target: BlockId(3),
                args: vec![ValueId(18)],
            },
        },
        Block {
            params: vec![],
            ops: vec![ValueId(19)],
            terminator: Terminator::Jump {
                target: BlockId(3),
                args: vec![ValueId(19)],
            },
        },
        Block {
            params: vec![ValueId(20)],
            ops: vec![ValueId(10)],
            terminator: Terminator::Return(None),
        },
    ]);
    func
}

fn integer(signed: bool) -> Op {
    op(OpKind::ConstInt(17), HirType::Int { bits: 32, signed })
}

#[test]
fn exact_widening_and_a_real_nullish_choice_keep_integer_facts() {
    let facts = FunctionFacts::of(&selected(integer(true)));
    assert_eq!(
        facts.value(ValueId(9)).numeric(),
        None,
        "absence survives the read"
    );
    let widened = facts.value(ValueId(11)).numeric().expect("exact widening");
    let present = facts
        .value(ValueId(19))
        .numeric()
        .expect("tag-refined read");
    let selected = facts.value(ValueId(20)).numeric().expect("numeric merge");
    assert_eq!(widened, present);
    assert_eq!(present, selected);
    assert_eq!(
        (selected.lo, selected.hi),
        (f64::from(i32::MIN), f64::from(i32::MAX))
    );
    assert!(selected.integral() && !selected.maybe_nan && !selected.maybe_negative_zero);
}

#[test]
fn no_default_or_the_wrong_tag_value_proves_no_integer_range() {
    let mut func = selected(integer(true));
    func.values[12].kind = OpKind::TagOf { value: ValueId(5) };
    assert_eq!(
        FunctionFacts::of(&func).value(ValueId(19)).numeric(),
        Some(Facts::TOP)
    );
    let mut func = selected(integer(true));
    func.values[17].kind = OpKind::ConstBool(false);
    assert_eq!(
        FunctionFacts::of(&func).value(ValueId(19)).numeric(),
        Some(Facts::TOP)
    );
}

#[test]
fn an_unsupported_boolean_arm_discards_a_partially_refined_answer() {
    let mut func = selected(integer(true));
    func.values[14].kind = OpKind::ConstBool(false);
    // The stack visits this supported arm first and can remove undefined.
    // The other arm is unsupported, so no prefix may become a numeric proof.
    func.values[16].kind = OpKind::Binary {
        op: BinOp::Eq,
        lhs: ValueId(12),
        rhs: ValueId(13),
    };
    assert_eq!(
        FunctionFacts::of(&func).value(ValueId(19)).numeric(),
        Some(Facts::TOP)
    );
}

#[test]
fn a_tag_test_beyond_the_unique_jump_limit_stays_unrefined() {
    let mut func = selected(integer(true));
    if let Terminator::Branch { else_target, .. } = &mut func.blocks[0].terminator {
        *else_target = BlockId(4);
    }
    for index in 4..13 {
        func.blocks.push(Block {
            params: vec![],
            ops: vec![],
            terminator: Terminator::Jump {
                target: if index == 12 {
                    BlockId(2)
                } else {
                    BlockId(index + 1)
                },
                args: vec![],
            },
        });
    }
    assert_eq!(
        FunctionFacts::of(&func).value(ValueId(19)).numeric(),
        Some(Facts::TOP)
    );
}

#[test]
fn a_merge_cannot_borrow_one_predecessors_tag_test() {
    let mut func = selected(integer(true));
    if let Terminator::Branch { then_target, .. } = &mut func.blocks[0].terminator {
        *then_target = BlockId(2);
    }
    assert_eq!(
        FunctionFacts::of(&func).value(ValueId(19)).numeric(),
        Some(Facts::TOP)
    );
}

#[test]
fn wide_unsigned_and_rounded_float_storage_stay_conservative() {
    let unsigned = FunctionFacts::of(&selected(integer(false)));
    assert_eq!(
        unsigned.value(ValueId(20)).numeric().expect("numeric").hi,
        f64::from(u32::MAX)
    );
    let narrow = selected(op(
        OpKind::ConstFloat(f64::from(i32::MAX)),
        HirType::Float { bits: 32 },
    ));
    assert_eq!(
        FunctionFacts::of(&narrow).value(ValueId(20)).numeric(),
        Some(Facts::TOP)
    );
}

#[test]
fn original_zero_sign_and_nonfinite_flags_survive_selection() {
    for number in [-0.0, f64::NAN, f64::INFINITY, 0.5] {
        let facts = FunctionFacts::of(&selected(op(OpKind::ConstFloat(number), super::number())));
        let selected = facts.value(ValueId(20)).numeric().expect("still numeric");
        assert_eq!(
            selected.maybe_negative_zero,
            number == 0.0 && number.is_sign_negative()
        );
        assert_eq!(selected.maybe_nan, number.is_nan());
        if number.is_infinite() {
            assert!(selected.hi.is_infinite());
        }
        if number.to_bits() == 0.5_f64.to_bits() {
            assert!(!selected.integral());
        }
    }
}
