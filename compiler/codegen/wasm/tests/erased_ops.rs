//! Cross-kind erased comparisons and truthiness execute against JS semantics.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, block, function, program, value};
use nts_core::hir::{
    Absent, BinOp, Callee, Func, HirType, ManagedType, OpKind, Terminator, UnOp, ValueId,
};

#[derive(Clone, Copy)]
enum Kind {
    Number,
    Boolean,
    String,
    Null,
    Undefined,
}
const KINDS: [Kind; 5] = [
    Kind::Number,
    Kind::Boolean,
    Kind::String,
    Kind::Null,
    Kind::Undefined,
];
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::String => "string",
            Self::Null => "null",
            Self::Undefined => "undefined",
        }
    }
    fn ty(self) -> Option<HirType> {
        match self {
            Self::Number => Some(F64),
            Self::Boolean => Some(HirType::Bool),
            Self::String => Some(HirType::Managed(ManagedType::String)),
            Self::Null | Self::Undefined => None,
        }
    }
    fn operand(self, f: &mut Func, ops: &mut Vec<ValueId>, at: &mut u32, boxed: bool) -> ValueId {
        let (op, ty) = match self {
            Self::Number | Self::Boolean | Self::String => {
                let param = *at;
                *at += 1;
                (OpKind::Param(param), self.ty().unwrap())
            }
            Self::Null => (OpKind::ConstNull, HirType::Erased),
            Self::Undefined => (OpKind::ConstUndefined, HirType::Erased),
        };
        let input = value(f, op, ty.clone());
        ops.push(input);
        if !boxed || ty == HirType::Erased {
            return input;
        }
        let erased = value(
            f,
            OpKind::Erase {
                value: input,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        );
        ops.push(erased);
        erased
    }
}
fn pair(
    name: &str,
    left: Kind,
    right: Kind,
    op: BinOp,
    typed: bool,
    swap: bool,
    external: Option<&str>,
) -> Func {
    let params = [left.ty(), right.ty()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let mut f = function(name, &params, HirType::Bool);
    let mut ops = Vec::new();
    let mut at = 0;
    let a = left.operand(&mut f, &mut ops, &mut at, !typed || !swap);
    let b = right.operand(&mut f, &mut ops, &mut at, !typed || swap);
    let comparison = if let Some(helper) = external {
        OpKind::Call {
            callee: Callee::External(helper.into()),
            args: vec![a, b],
            frame: None,
        }
    } else {
        OpKind::Binary { op, lhs: a, rhs: b }
    };
    let result = value(&mut f, comparison, HirType::Bool);
    ops.push(result);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(result))));
    f
}
fn truthy(name: &str, kind: Kind, op: UnOp, external: Option<&str>, convert: bool) -> Func {
    let params = kind.ty().into_iter().collect::<Vec<_>>();
    let mut f = function(name, &params, HirType::Bool);
    let mut ops = Vec::new();
    let operand = kind.operand(&mut f, &mut ops, &mut 0, true);
    let operation = if let Some(helper) = external {
        OpKind::Call {
            callee: Callee::External(helper.into()),
            args: vec![operand],
            frame: None,
        }
    } else if convert {
        OpKind::Convert(operand)
    } else {
        OpKind::Unary { op, operand }
    };
    let result = value(&mut f, operation, HirType::Bool);
    ops.push(result);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(result))));
    f
}
fn nullable_truthy(name: &str, undefined: bool, op: UnOp) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let input = value(
        &mut f,
        if undefined {
            OpKind::ConstUndefined
        } else {
            OpKind::ConstNull
        },
        HirType::Managed(ManagedType::String),
    );
    let result = value(&mut f, OpKind::Unary { op, operand: input }, HirType::Bool);
    f.blocks.push(block(
        &[],
        &[input, result],
        Terminator::Return(Some(result)),
    ));
    f
}
fn external_roundtrip(name: &str, ty: HirType, box_: &str, unbox: &str) -> Func {
    let mut f = function(name, std::slice::from_ref(&ty), ty.clone());
    let input = value(&mut f, OpKind::Param(0), ty.clone());
    let boxed = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External(box_.into()),
            args: vec![input],
            frame: None,
        },
        HirType::Erased,
    );
    let result = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External(unbox.into()),
            args: vec![boxed],
            frame: None,
        },
        ty,
    );
    f.blocks.push(block(
        &[],
        &[input, boxed, result],
        Terminator::Return(Some(result)),
    ));
    f
}

fn comparisons() -> Vec<Func> {
    let mut funcs = Vec::new();
    for left in KINDS {
        for right in KINDS {
            let suffix = format!("{}_{}", left.name(), right.name());
            for (prefix, op) in [("eq", BinOp::Eq), ("ne", BinOp::Ne)] {
                funcs.push(pair(
                    &format!("{prefix}_{suffix}"),
                    left,
                    right,
                    op,
                    false,
                    false,
                    None,
                ));
            }
            funcs.push(pair(
                &format!("external_{suffix}"),
                left,
                right,
                BinOp::Eq,
                false,
                false,
                Some("nts_value_strict_eq"),
            ));
            if right.ty().is_some() {
                funcs.push(pair(
                    &format!("typed_{suffix}"),
                    left,
                    right,
                    BinOp::Eq,
                    true,
                    false,
                    None,
                ));
                for (alias, name) in match right {
                    Kind::Number => vec![
                        ("helper", "nts_value_eq_number"),
                        ("alias", "nts_value_eq_number_fn"),
                    ],
                    Kind::Boolean => vec![
                        ("helper", "nts_value_eq_boolean"),
                        ("alias", "nts_value_eq_boolean_fn"),
                    ],
                    Kind::String => vec![("helper", "nts_value_eq_string")],
                    Kind::Null | Kind::Undefined => vec![],
                } {
                    funcs.push(pair(
                        &format!("{alias}_{suffix}"),
                        left,
                        right,
                        BinOp::Eq,
                        true,
                        false,
                        Some(name),
                    ));
                }
            }
            if left.ty().is_some() {
                funcs.push(pair(
                    &format!("swap_{suffix}"),
                    left,
                    right,
                    BinOp::Eq,
                    true,
                    true,
                    None,
                ));
            }
        }
    }
    funcs
}

#[test]
fn erased_equality_typed_guards_and_truthiness_match_javascript() {
    let mut funcs = comparisons();
    for kind in KINDS {
        for (prefix, op, external, convert) in [
            ("truthy", UnOp::Truthy, None, false),
            ("not", UnOp::Not, None, false),
            ("convert", UnOp::Truthy, None, true),
            (
                "truthyHelper",
                UnOp::Truthy,
                Some("nts_value_truthy"),
                false,
            ),
            (
                "truthyAlias",
                UnOp::Truthy,
                Some("nts_value_truthy_fn"),
                false,
            ),
        ] {
            funcs.push(truthy(
                &format!("{prefix}_{}", kind.name()),
                kind,
                op,
                external,
                convert,
            ));
        }
    }
    for (name, undefined) in [("null", false), ("undefined", true)] {
        funcs.push(nullable_truthy(
            &format!("nullableTruthy_{name}"),
            undefined,
            UnOp::Truthy,
        ));
        funcs.push(nullable_truthy(
            &format!("nullableNot_{name}"),
            undefined,
            UnOp::Not,
        ));
    }
    funcs.push(external_roundtrip(
        "externalNumber",
        F64,
        "nts_value_of_number",
        "nts_value_number",
    ));
    funcs.push(external_roundtrip(
        "externalBoolean",
        HirType::Bool,
        "nts_value_of_boolean",
        "nts_value_boolean",
    ));
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let report = common::run(
        "erased-ops",
        &emitted,
        "tooling/wasm/check-erased-ops.mjs",
        &[],
    );
    assert!(report["cases"].as_u64().unwrap() > 10_000);
}
