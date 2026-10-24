//! Copy ranges, aliased growth and in-place reversal have independent JS oracles.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{
    Absent, ArrayFill, BinOp, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
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
    fn int(&mut self, n: i128) -> ValueId {
        self.op(OpKind::ConstInt(n), U32)
    }
    fn dense(&mut self, ty: HirType, items: &[ValueId]) -> ValueId {
        let len = self.int(items.len() as i128);
        let a = self.op(
            OpKind::ArrayNew {
                length: len,
                fill: ArrayFill::Holes,
            },
            array(ty),
        );
        for (at, &input) in items.iter().enumerate() {
            let index = self.int(at as i128);
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
    fn get(&mut self, a: ValueId, at: ValueId, ty: HirType) -> ValueId {
        self.op(
            OpKind::ArrayGet {
                array: a,
                index: at,
                checked: true,
            },
            ty,
        )
    }
    fn finish(mut self, result: ValueId) -> Func {
        self.f
            .blocks
            .push(block(&[], &self.ops, Terminator::Return(Some(result))));
        self.f
    }
}
fn copy(name: &str, ty: HirType, helper: &str, slicing: bool, length: bool, self_: bool) -> Func {
    let mut params = vec![ty.clone(), ty.clone()];
    if slicing {
        params.extend([F64, F64]);
    }
    if !length {
        params.push(U32);
    }
    let mut b = Build::new(name, &params, if length { F64 } else { ty.clone() });
    let x = b.param(0);
    let y = b.param(1);
    let a = b.dense(ty.clone(), &[x, y, x]);
    let result = if slicing {
        let from = b.param(2);
        let to = b.param(3);
        b.call(helper, &[a, from, to], array(ty.clone()))
    } else {
        let other = if self_ {
            a
        } else {
            b.dense(ty.clone(), &[y, x])
        };
        if helper.starts_with("nts_array_extend") {
            b.call(helper, &[a, other], HirType::Void);
            a
        } else {
            b.call(helper, &[a, other], array(ty.clone()))
        }
    };
    let output = if length {
        b.op(OpKind::Length(result), F64)
    } else {
        let at = b.param(u32::try_from(params.len()).unwrap() - 1);
        b.get(result, at, ty)
    };
    b.finish(output)
}
fn reverse(name: &str, ty: HirType, count: usize, identity: bool) -> Func {
    let mut b = Build::new(
        name,
        &[ty.clone(), ty.clone(), U32],
        if identity { HirType::Bool } else { ty.clone() },
    );
    let x = b.param(0);
    let y = b.param(1);
    let at = b.param(2);
    let items = [x, y, x, y, y];
    let a = b.dense(ty.clone(), &items[..count]);
    let helper = if ty == F64 {
        "nts_array_reverse"
    } else {
        "nts_array_reverse_ref"
    };
    let alias = b.call(helper, &[a], array(ty.clone()));
    let output = if identity {
        b.op(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: a,
                rhs: alias,
            },
            HirType::Bool,
        )
    } else {
        b.get(a, at, ty)
    };
    b.finish(output)
}
fn fresh(helper: &str) -> Func {
    let mut b = Build::new(&format!("fresh_{helper}"), &[], HirType::Bool);
    let a = b.dense(F64, &[]);
    let result = if helper == "nts_array_slice" {
        let zero = b.op(OpKind::ConstFloat(0.0), F64);
        b.call(helper, &[a, zero, zero], array(F64))
    } else {
        b.call(helper, &[a, a], array(F64))
    };
    let distinct = b.op(
        OpKind::Binary {
            op: BinOp::Ne,
            lhs: a,
            rhs: result,
        },
        HirType::Bool,
    );
    b.finish(distinct)
}
fn nested(helper: &str) -> Func {
    let mut b = Build::new(&format!("nested_{helper}"), &[], HirType::Bool);
    let child = b.dense(F64, &[]);
    let ty = array(F64);
    let a = b.dense(ty.clone(), &[child, child]);
    let output = if helper == "nts_array_slice_ref" {
        let zero = b.op(OpKind::ConstFloat(0.0), F64);
        let one = b.op(OpKind::ConstFloat(1.0), F64);
        b.call(helper, &[a, zero, one], array(ty.clone()))
    } else if helper == "nts_array_extend_ref" {
        b.call(helper, &[a, a], HirType::Void);
        a
    } else if helper == "nts_array_reverse_ref" {
        b.call(helper, &[a], array(ty.clone()))
    } else {
        b.call(helper, &[a, a], array(ty.clone()))
    };
    let zero = b.int(0);
    let item = b.get(output, zero, ty);
    let same = b.op(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: item,
            rhs: child,
        },
        HirType::Bool,
    );
    b.finish(same)
}
fn erased_concat() -> Func {
    let mut b = Build::new("concatValueNumber", &[F64, F64, U32], F64);
    let x = b.param(0);
    let y = b.param(1);
    let at = b.param(2);
    let x = b.op(
        OpKind::Erase {
            value: x,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let y = b.op(
        OpKind::Erase {
            value: y,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let a = b.dense(HirType::Erased, &[x, y]);
    let result = b.call("nts_array_concat_value", &[a, a], array(HirType::Erased));
    let item = b.get(result, at, HirType::Erased);
    let item = b.op(OpKind::unerase(item), F64);
    b.finish(item)
}
#[test]
fn typed_copying_and_movement_match_js() {
    let mut funcs = vec![
        fresh("nts_array_slice"),
        fresh("nts_array_concat"),
        erased_concat(),
    ];
    for (suffix, ty) in [("Number", F64), ("String", string())] {
        let ref_ = if ty == F64 { "" } else { "_ref" };
        for length in [false, true] {
            funcs.push(copy(
                &format!("slice{suffix}{length}"),
                ty.clone(),
                &format!("nts_array_slice{ref_}"),
                true,
                length,
                false,
            ));
            for self_ in [false, true] {
                for helper in ["concat", "extend"] {
                    funcs.push(copy(
                        &format!("{helper}{suffix}{length}{self_}"),
                        ty.clone(),
                        &format!("nts_array_{helper}{ref_}"),
                        false,
                        length,
                        self_,
                    ));
                }
            }
        }
        for count in [0, 1, 2, 5] {
            for identity in [false, true] {
                funcs.push(reverse(
                    &format!("reverse{suffix}{count}{identity}"),
                    ty.clone(),
                    count,
                    identity,
                ));
            }
        }
    }
    for helper in [
        "nts_array_slice_ref",
        "nts_array_concat_ref",
        "nts_array_extend_ref",
        "nts_array_reverse_ref",
    ] {
        funcs.push(nested(helper));
    }
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let report = common::run(
        "array-copy",
        &emitted,
        "tooling/wasm/check-array-copy.mjs",
        &[],
    );
    assert!(report["cases"].as_u64().unwrap() > 10000);
    assert!(report["named_declines"].as_u64().unwrap() > 1000);
}

#[test]
fn copy_result_cannot_reinterpret_mutable_storage() {
    let mut f = copy("badCopy", F64, "nts_array_concat", false, true, false);
    for op in &mut f.values {
        if let OpKind::Call {
            callee: Callee::External(name),
            ..
        } = &op.kind
            && name == "nts_array_concat"
        {
            op.ty = array(string());
        }
    }
    let error = nts_codegen_wasm::emit(&program(vec![f]))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("badCopy")
            && error.contains("nts_array_concat")
            && error.contains("mutable"),
        "{error}"
    );
}
