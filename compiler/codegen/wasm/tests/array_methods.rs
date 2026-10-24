//! Runtime helper contracts, alias-preserving mutation and optional results.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{
    Absent, ArrayFill, BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator,
    ValueId,
};

fn array(element: HirType) -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(element)))
}
fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}
struct Build {
    f: Func,
    ops: Vec<ValueId>,
}
impl Build {
    fn new(name: &str, params: &[HirType], result: HirType) -> Self {
        Self {
            f: function(name, params, result),
            ops: vec![],
        }
    }
    fn op(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        let id = value(&mut self.f, kind, ty);
        self.ops.push(id);
        id
    }
    fn param(&mut self, index: u32) -> ValueId {
        self.op(
            OpKind::Param(index),
            self.f.params[index as usize].ty.clone(),
        )
    }
    fn int(&mut self, n: i128) -> ValueId {
        self.op(OpKind::ConstInt(n), U32)
    }
    fn array(&mut self, ty: HirType, length: ValueId) -> ValueId {
        self.op(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            array(ty),
        )
    }
    fn call(&mut self, name: &str, args: &[ValueId], result: HirType) -> ValueId {
        self.op(
            OpKind::Call {
                callee: Callee::External(name.into()),
                args: args.to_vec(),
                frame: None,
            },
            result,
        )
    }
    fn finish(mut self, result: ValueId) -> Func {
        self.f
            .blocks
            .push(block(&[], &self.ops, Terminator::Return(Some(result))));
        self.f
    }
}
fn roundtrip(name: &str, ty: HirType, push: &str, pop: &str) -> Func {
    let mut b = Build::new(name, std::slice::from_ref(&ty), ty.clone());
    let input = b.param(0);
    let zero = b.int(0);
    let a = b.array(ty.clone(), zero);
    b.call(push, &[a, input], F64);
    let result = b.call(pop, &[a], ty);
    b.finish(result)
}
/// Two pushed, two shifted: the second shift answers the second value, so the
/// first shift moved it down.
fn shift_twice(name: &str, ty: HirType, push: &str, shift: &str) -> Func {
    let mut b = Build::new(name, &[ty.clone(), ty.clone()], ty.clone());
    let first = b.param(0);
    let second = b.param(1);
    let zero = b.int(0);
    let a = b.array(ty.clone(), zero);
    b.call(push, &[a, first], F64);
    b.call(push, &[a, second], F64);
    b.call(shift, &[a], ty.clone());
    let result = b.call(shift, &[a], ty);
    b.finish(result)
}
fn push_length() -> Func {
    let mut b = Build::new("pushLength", &[F64], F64);
    let input = b.param(0);
    let zero = b.int(0);
    let a = b.array(F64, zero);
    let result = b.call("nts_array_push", &[a, input], F64);
    b.finish(result)
}
fn clear_holes() -> Func {
    let mut b = Build::new("clearHoles", &[U32, F64], F64);
    let len = b.param(0);
    let input = b.param(1);
    let a = b.array(F64, len);
    let zero = b.int(0);
    b.call("nts_array_keep_first", &[a, zero], HirType::Void);
    b.call("nts_array_push", &[a, input], HirType::Void);
    let result = b.op(
        OpKind::ArrayGet {
            array: a,
            index: zero,
            checked: true,
        },
        F64,
    );
    b.finish(result)
}
fn clear_reference_holes() -> Func {
    let mut b = Build::new("clearReferenceHoles", &[U32, string()], string());
    let len = b.param(0);
    let input = b.param(1);
    let a = b.array(string(), len);
    let zero = b.int(0);
    b.call("nts_array_keep_first", &[a, zero], HirType::Void);
    b.call("nts_array_push_ref", &[a, input], HirType::Void);
    let result = b.op(
        OpKind::ArrayGet {
            array: a,
            index: zero,
            checked: true,
        },
        string(),
    );
    b.finish(result)
}
fn empty_number() -> Func {
    let mut b = Build::new("emptyNumber", &[], F64);
    let zero = b.int(0);
    let a = b.array(F64, zero);
    let result = b.call("nts_array_pop", &[a], F64);
    b.finish(result)
}
fn truncate_boolean() -> Func {
    let mut b = Build::new("truncateBoolean", &[F64, HirType::Bool], F64);
    let count = b.param(0);
    let input = b.param(1);
    let len = b.int(4);
    let a = b.array(HirType::Bool, len);
    b.call("nts_array_fill_bool", &[a, input], array(HirType::Bool));
    b.call("nts_array_set_length", &[a, count], HirType::Void);
    let result = b.op(OpKind::Length(a), F64);
    b.finish(result)
}
fn retained(name: &str, ty: HirType, fill: &str, trim: &str, push: &str) -> Func {
    let mut b = Build::new(name, &[F64, ty.clone(), ty.clone(), U32], ty.clone());
    let count = b.param(0);
    let old = b.param(1);
    let new = b.param(2);
    let at = b.param(3);
    let len = b.int(4);
    let a = b.array(ty.clone(), len);
    let alias = b.call(fill, &[a, old], array(ty.clone()));
    b.call(trim, &[a, count], HirType::Void);
    b.call(push, &[a, new], HirType::Void);
    let result = b.op(
        OpKind::ArrayGet {
            array: alias,
            index: at,
            checked: true,
        },
        ty,
    );
    b.finish(result)
}
fn fill_identity() -> Func {
    let mut b = Build::new("fillIdentity", &[U32], HirType::Bool);
    let len = b.param(0);
    let a = b.array(F64, len);
    let input = b.op(OpKind::ConstFloat(17.0), F64);
    let alias = b.call("nts_array_fill", &[a, input], array(F64));
    let result = b.op(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: a,
            rhs: alias,
        },
        HirType::Bool,
    );
    b.finish(result)
}
fn optional(empty: bool) -> Func {
    let mut b = Build::new(
        if empty {
            "emptyValue"
        } else {
            "optionalNumber"
        },
        &[F64],
        if empty { U32 } else { F64 },
    );
    let input = b.param(0);
    let zero = b.int(0);
    let a = b.array(F64, zero);
    if !empty {
        b.call("nts_array_push", &[a, input], F64);
    }
    let v = b.call("nts_array_pop_value", &[a], HirType::Erased);
    let result = b.op(
        if empty {
            OpKind::TagOf { value: v }
        } else {
            OpKind::unerase(v)
        },
        if empty { U32 } else { F64 },
    );
    b.finish(result)
}
fn empty_ref() -> Func {
    let mut b = Build::new("emptyReference", &[], U32);
    let zero = b.int(0);
    let a = b.array(string(), zero);
    let v = b.call("nts_array_pop_ref", &[a], string());
    let e = b.op(
        OpKind::Erase {
            value: v,
            absent: Absent::Undefined,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let result = b.op(OpKind::TagOf { value: e }, U32);
    b.finish(result)
}
fn fill(name: &str, ty: HirType, helper: &str) -> Func {
    let mut b = Build::new(name, &[U32, ty.clone(), U32], ty.clone());
    let n = b.param(0);
    let input = b.param(1);
    let at = b.param(2);
    let a = b.array(ty.clone(), n);
    let alias = b.call(helper, &[a, input], array(ty.clone()));
    let result = b.op(
        OpKind::ArrayGet {
            array: alias,
            index: at,
            checked: true,
        },
        ty,
    );
    b.finish(result)
}
fn truncate(name: &str, ty: HirType, fill: &str, trim: &str, push: &str) -> Func {
    let mut b = Build::new(name, &[F64, ty.clone()], F64);
    let n = b.param(0);
    let input = b.param(1);
    let len = b.int(4);
    let a = b.array(ty.clone(), len);
    let alias = b.call(fill, &[a, input], array(ty));
    b.call(trim, &[a, n], HirType::Void);
    b.call(push, &[a, input], HirType::Void);
    let result = b.op(OpKind::Length(alias), F64);
    b.finish(result)
}
fn erased_push() -> Func {
    let mut b = Build::new("erasedPush", &[F64], F64);
    let input = b.param(0);
    let zero = b.int(0);
    let a = b.array(HirType::Erased, zero);
    let erased = b.op(
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    b.call("nts_array_push_value", &[a, erased], F64);
    let item = b.op(
        OpKind::ArrayGet {
            array: a,
            index: zero,
            checked: true,
        },
        HirType::Erased,
    );
    b.call("nts_array_set_length_value", &[a, zero], HirType::Void);
    let result = b.op(OpKind::unerase(item), F64);
    b.finish(result)
}
fn nested() -> Func {
    let mut b = Build::new("nestedReference", &[], HirType::Bool);
    let zero = b.int(0);
    let inner = b.array(F64, zero);
    let outer = b.array(array(F64), zero);
    b.call("nts_array_push_ref", &[outer, inner], F64);
    let popped = b.call("nts_array_pop_ref", &[outer], array(F64));
    let result = b.op(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: inner,
            rhs: popped,
        },
        HirType::Bool,
    );
    b.finish(result)
}
fn growth() -> Func {
    let mut builder = Build::new("referenceGrowth", &[U32, string()], F64);
    let limit = builder.param(0);
    let input = builder.param(1);
    let zero = builder.int(0);
    let storage = builder.array(string(), zero);
    let erased = builder.op(
        OpKind::Erase {
            value: storage,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let alias = builder.op(OpKind::unerase(erased), array(string()));
    builder.f.blocks.push(block(
        &[],
        &builder.ops,
        Terminator::Jump {
            target: BlockId(1),
            args: vec![zero],
        },
    ));
    let index = value(&mut builder.f, OpKind::BlockParam(0), U32);
    let cond = value(
        &mut builder.f,
        OpKind::Binary {
            op: BinOp::Lt,
            lhs: index,
            rhs: limit,
        },
        HirType::Bool,
    );
    builder.f.blocks.push(block(
        &[index],
        &[cond],
        Terminator::Branch {
            cond,
            then_target: BlockId(2),
            then_args: vec![],
            else_target: BlockId(3),
            else_args: vec![],
        },
    ));
    builder.ops.clear();
    builder.call("nts_array_push_ref", &[storage, input], F64);
    let one = builder.int(1);
    let next = builder.op(
        OpKind::Binary {
            op: BinOp::Add,
            lhs: index,
            rhs: one,
        },
        U32,
    );
    builder.f.blocks.push(block(
        &[],
        &builder.ops,
        Terminator::Jump {
            target: BlockId(1),
            args: vec![next],
        },
    ));
    let len = value(&mut builder.f, OpKind::Length(alias), F64);
    builder
        .f
        .blocks
        .push(block(&[], &[len], Terminator::Return(Some(len))));
    builder.f
}

#[test]
fn typed_array_methods_match_node() {
    let funcs = vec![
        clear_reference_holes(),
        empty_number(),
        truncate_boolean(),
        push_length(),
        clear_holes(),
        fill_identity(),
        retained(
            "retainedNumber",
            F64,
            "nts_array_fill",
            "nts_array_set_length",
            "nts_array_push",
        ),
        retained(
            "retainedReference",
            string(),
            "nts_array_fill_ref",
            "nts_array_set_length_ref",
            "nts_array_push_ref",
        ),
        roundtrip("number", F64, "nts_array_push", "nts_array_pop"),
        shift_twice("shiftNumber", F64, "nts_array_push", "nts_array_shift"),
        shift_twice(
            "shiftReference",
            string(),
            "nts_array_push_ref",
            "nts_array_shift_ref",
        ),
        roundtrip(
            "reference",
            string(),
            "nts_array_push_ref",
            "nts_array_pop_ref",
        ),
        optional(false),
        optional(true),
        empty_ref(),
        fill("fillNumber", F64, "nts_array_fill"),
        fill("fillBoolean", HirType::Bool, "nts_array_fill_bool"),
        fill("fillReference", string(), "nts_array_fill_ref"),
        truncate(
            "truncateNumber",
            F64,
            "nts_array_fill",
            "nts_array_set_length",
            "nts_array_push",
        ),
        truncate(
            "truncateReference",
            string(),
            "nts_array_fill_ref",
            "nts_array_set_length_ref",
            "nts_array_push_ref",
        ),
        erased_push(),
        nested(),
        growth(),
    ];
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let output = common::run(
        "array-methods",
        &emitted,
        "tooling/wasm/check-array-methods.mjs",
        &[],
    );
    assert!(output["cases"].as_u64().unwrap() > 2000, "{output}");
    assert!(output["named_declines"].as_u64().unwrap() > 10);
}

#[test]
fn result_value_suffix_does_not_accept_erased_element_storage() {
    let mut b = Build::new("wrongPopWidth", &[], U32);
    let zero = b.int(0);
    let a = b.array(HirType::Erased, zero);
    let popped = b.call("nts_array_pop_value", &[a], HirType::Erased);
    let tag = b.op(OpKind::TagOf { value: popped }, U32);
    let nts_codegen_wasm::EmitError::Declined(ds) =
        nts_codegen_wasm::emit(&program(vec![b.finish(tag)])).unwrap_err()
    else {
        panic!("expected helper contract refusal")
    };
    assert!(
        ds.iter()
            .any(|d| d.message.contains("nts_array_pop_value") && d.message.contains("Erased")),
        "{ds:?}"
    );
}
