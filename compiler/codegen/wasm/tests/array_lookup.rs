//! Lookup results follow JS value equality and optional-number absence.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{
    Absent, BinOp, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
};
fn array(ty: HirType) -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(ty)))
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
    fn param(&mut self, at: u32) -> ValueId {
        self.op(OpKind::Param(at), self.f.params[at as usize].ty.clone())
    }
    fn dense(&mut self, ty: HirType, items: &[ValueId]) -> ValueId {
        let len = self.op(OpKind::ConstInt(items.len() as i128), U32);
        let a = self.op(
            OpKind::ArrayNew {
                length: len,
                zeroed: true,
            },
            array(ty),
        );
        for (at, &input) in items.iter().enumerate() {
            let index = self.op(OpKind::ConstInt(at as i128), U32);
            self.op(
                OpKind::ArraySet {
                    array: a,
                    index,
                    value: input,
                    checked: true,
                },
                HirType::Void,
            );
        }
        a
    }
    fn call(&mut self, name: &str, args: &[ValueId], ty: HirType) -> ValueId {
        self.op(
            OpKind::Call {
                callee: Callee::External(name.into()),
                args: args.to_vec(),
                frame: None,
            },
            ty,
        )
    }
    fn finish(mut self, out: ValueId) -> Func {
        self.f
            .blocks
            .push(block(&[], &self.ops, Terminator::Return(Some(out))));
        self.f
    }
}
fn output_type(helper: &str) -> HirType {
    if helper.contains("includes") {
        HirType::Bool
    } else {
        F64
    }
}
fn search(name: &str, ty: HirType, helper: &str, count: usize, needle: HirType) -> Func {
    let mut b = Build::new(name, &[ty.clone(), ty.clone(), needle], output_type(helper));
    let x = b.param(0);
    let y = b.param(1);
    let needle = b.param(2);
    let items = b.dense(ty, &[x, y, x][..count]);
    let needle = if helper.ends_with("_value") {
        b.op(
            OpKind::Erase {
                value: needle,
                absent: Absent::Impossible,
            },
            HirType::Erased,
        )
    } else {
        needle
    };
    let out = b.call(helper, &[items, needle], output_type(helper));
    b.finish(out)
}
fn at(name: &str, ty: HirType, count: usize, projection: Option<bool>) -> Func {
    let result = if projection == Some(true) {
        U32
    } else {
        ty.clone()
    };
    let mut b = Build::new(name, &[ty.clone(), ty.clone(), F64], result);
    let x = b.param(0);
    let y = b.param(1);
    let index = b.param(2);
    let a = b.dense(ty.clone(), &[x, y, x][..count]);
    let helper = if projection.is_some() {
        "nts_array_at_value"
    } else if ty == F64 {
        "nts_array_at"
    } else {
        "nts_array_at_ref"
    };
    let out = b.call(
        helper,
        &[a, index],
        if projection.is_some() {
            HirType::Erased
        } else {
            ty
        },
    );
    let out = match projection {
        Some(true) => b.op(OpKind::TagOf { value: out }, U32),
        Some(false) => b.op(OpKind::Unerase { value: out }, F64),
        None => out,
    };
    b.finish(out)
}
fn identity(helper: &str, hit: bool) -> Func {
    let mut b = Build::new(
        &format!("identity_{helper}_{hit}"),
        &[],
        output_type(helper),
    );
    let a = b.dense(F64, &[]);
    let c = b.dense(F64, &[]);
    let array = b.dense(array(F64), &[a, c, a]);
    let needle = if hit { a } else { b.dense(F64, &[]) };
    let out = b.call(helper, &[array, needle], output_type(helper));
    b.finish(out)
}
fn at_identity() -> Func {
    let mut b = Build::new("atIdentity", &[F64], HirType::Bool);
    let at = b.param(0);
    let a = b.dense(F64, &[]);
    let c = b.dense(F64, &[]);
    let items = b.dense(array(F64), &[a, c, a]);
    let out = b.call("nts_array_at_ref", &[items, at], array(F64));
    let out = b.op(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: out,
            rhs: a,
        },
        HirType::Bool,
    );
    b.finish(out)
}
fn absent_needle(helper: &str, null: bool, nullable_element: bool) -> Func {
    let name = format!("absent_{helper}_{null}_{nullable_element}");
    let mut b = Build::new(&name, &[], output_type(helper));
    let item = if nullable_element {
        b.op(OpKind::ConstUndefined, string())
    } else {
        b.op(OpKind::ConstString("a".into()), string())
    };
    let a = b.dense(string(), &[item]);
    let z = b.op(
        if null {
            OpKind::ConstNull
        } else {
            OpKind::ConstUndefined
        },
        HirType::Erased,
    );
    let out = b.call(helper, &[a, z], output_type(helper));
    b.finish(out)
}
#[test]
fn numeric_string_identity_and_optional_lookup_match_js() {
    let mut funcs = vec![at_identity()];
    for count in [0, 1, 3] {
        for (suffix, ty, helpers) in [
            (
                "Number",
                F64,
                vec![
                    "nts_array_index_of",
                    "nts_array_includes",
                    "nts_array_last_index_of",
                ],
            ),
            (
                "String",
                string(),
                vec!["nts_array_index_of_str", "nts_array_includes_str"],
            ),
        ] {
            for helper in helpers {
                funcs.push(search(
                    &format!("{helper}{suffix}{count}"),
                    ty.clone(),
                    helper,
                    count,
                    ty.clone(),
                ));
            }
            funcs.push(at(&format!("at{suffix}{count}"), ty, count, None));
        }
        for projection in [true, false] {
            funcs.push(at(
                &format!("atValue{projection}{count}"),
                F64,
                count,
                Some(projection),
            ));
        }
        for helper in [
            "nts_array_index_of_str_value",
            "nts_array_includes_str_value",
        ] {
            for (suffix, ty) in [
                ("String", string()),
                ("Number", F64),
                ("Boolean", HirType::Bool),
            ] {
                funcs.push(search(
                    &format!("{helper}{suffix}{count}"),
                    string(),
                    helper,
                    count,
                    ty,
                ));
            }
        }
    }
    for helper in ["nts_array_index_of_ref", "nts_array_includes_ref"] {
        for hit in [false, true] {
            funcs.push(identity(helper, hit));
        }
    }
    for helper in [
        "nts_array_index_of_str_value",
        "nts_array_includes_str_value",
    ] {
        for null in [false, true] {
            for nullable in [false, true] {
                funcs.push(absent_needle(helper, null, nullable));
            }
        }
    }
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let report = common::run(
        "array-lookup",
        &emitted,
        "tooling/wasm/check-array-lookup.mjs",
        &[],
    );
    assert!(report["cases"].as_u64().unwrap() > 5000, "{report}");
    assert!(report["named_declines"].as_u64().unwrap() > 100, "{report}");
}
#[test]
fn optional_number_lookup_never_reads_erased_element_storage() {
    let mut b = Build::new("wrongAtStorage", &[F64], U32);
    let at = b.param(0);
    let a = b.dense(HirType::Erased, &[]);
    let out = b.call("nts_array_at_value", &[a, at], HirType::Erased);
    let tag = b.op(OpKind::TagOf { value: out }, U32);
    let error = nts_codegen_wasm::emit(&program(vec![b.finish(tag)]))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("wrongAtStorage")
            && error.contains("nts_array_at_value")
            && error.contains("Erased"),
        "{error}"
    );
}
