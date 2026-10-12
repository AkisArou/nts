//! Source throws retain payloads; host activation cleanup survives every exit.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, block, function, program, value};
use nts_core::hir::{
    Absent, BinOp, Callee, ClassId, Func, HirType, Layout, ManagedType, OpKind, Terminator, ValueId,
};

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}
fn object() -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(1)))
}
fn op(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
fn call(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    name: &str,
    args: Vec<ValueId>,
    ty: HirType,
) -> ValueId {
    op(
        f,
        ops,
        OpKind::Call {
            callee: Callee::External(name.into()),
            args,
            frame: None,
        },
        ty,
    )
}
fn erase(f: &mut Func, ops: &mut Vec<ValueId>, input: ValueId) -> ValueId {
    op(
        f,
        ops,
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
        },
        HirType::Erased,
    )
}
fn thrown(name: &str, ty: Option<HirType>, uncaught: bool, null: bool) -> Func {
    let mut f = function(name, &ty.clone().into_iter().collect::<Vec<_>>(), string());
    let mut ops = vec![];
    let payload = if let Some(ty) = ty {
        let input = op(&mut f, &mut ops, OpKind::Param(0), ty);
        erase(&mut f, &mut ops, input)
    } else {
        op(
            &mut f,
            &mut ops,
            if null {
                OpKind::ConstNull
            } else {
                OpKind::ConstUndefined
            },
            HirType::Erased,
        )
    };
    if uncaught {
        let detail = op(
            &mut f,
            &mut ops,
            OpKind::ConstString("ignored detail".into()),
            string(),
        );
        call(
            &mut f,
            &mut ops,
            "nts_uncaught",
            vec![payload, detail],
            HirType::Void,
        );
        f.blocks.push(block(&[], &ops, Terminator::Unreachable));
    } else {
        call(&mut f, &mut ops, "nts_raise", vec![payload], HirType::Void);
        // This placeholder is outside the public primitive-string boundary:
        // pending publication MUST precede output conversion.
        let placeholder = op(&mut f, &mut ops, OpKind::ConstNull, string());
        f.blocks
            .push(block(&[], &ops, Terminator::Return(Some(placeholder))));
    }
    f
}
fn pending() -> Func {
    let mut f = function("pending", &[], I32);
    let mut ops = vec![];
    let flag = call(&mut f, &mut ops, "nts_raising", vec![], I32);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(flag))));
    f
}
fn caught_object(uncaught: bool) -> Func {
    let mut f = function(
        if uncaught {
            "uncaughtObject"
        } else {
            "caughtObject"
        },
        &[],
        HirType::Bool,
    );
    let mut ops = vec![];
    let object = op(
        &mut f,
        &mut ops,
        OpKind::ObjectNew { frame: false },
        object(),
    );
    let payload = erase(&mut f, &mut ops, object);
    if uncaught {
        let detail = op(&mut f, &mut ops, OpKind::ConstNull, string());
        call(
            &mut f,
            &mut ops,
            "nts_uncaught",
            vec![payload, detail],
            HirType::Void,
        );
        f.blocks.push(block(&[], &ops, Terminator::Unreachable));
    } else {
        call(&mut f, &mut ops, "nts_raise", vec![payload], HirType::Void);
        let taken = call(&mut f, &mut ops, "nts_raise_take", vec![], HirType::Erased);
        let identity = op(
            &mut f,
            &mut ops,
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: taken,
                rhs: payload,
            },
            HirType::Bool,
        );
        f.blocks
            .push(block(&[], &ops, Terminator::Return(Some(identity))));
    }
    f
}
fn refusal() -> Func {
    let mut f = function("refusal", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let payload = erase(&mut f, &mut ops, input);
    call(&mut f, &mut ops, "nts_raise", vec![payload], HirType::Void);
    let null = op(&mut f, &mut ops, OpKind::ConstNull, string());
    let length = op(&mut f, &mut ops, OpKind::Length(null), F64);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(length))));
    f
}
fn fixture() -> nts_core::hir::Program {
    let mut funcs = vec![
        pending(),
        refusal(),
        caught_object(false),
        caught_object(true),
    ];
    for uncaught in [false, true] {
        let prefix = if uncaught { "uncaught" } else { "raise" };
        for (suffix, ty, null) in [
            ("Number", Some(F64), false),
            ("Boolean", Some(HirType::Bool), false),
            ("String", Some(string()), false),
            ("Undefined", None, false),
            ("Null", None, true),
        ] {
            funcs.push(thrown(&format!("{prefix}{suffix}"), ty, uncaught, null));
        }
    }
    let mut p = program(funcs);
    p.layouts.push(Layout {
        types: vec![ClassId(1)],
        name: "Payload".into(),
        fields: vec![],
        methods: vec![],
        interfaces: vec![],
        base: None,
    });
    p
}

#[test]
fn explicit_raising_and_host_cleanup_preserve_actual_values() {
    let emitted = nts_codegen_wasm::emit(&fixture()).unwrap();
    assert!(emitted.manifest.activation.is_some());
    let report = common::run("raising", &emitted, "tooling/wasm/check-raising.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 100);
    assert_eq!(report["nested_reentry"], true);
    assert_eq!(report["host_exception_cleanup"], true);
    assert_eq!(report["cold_refusal_cleanup"], true);
    assert_eq!(report["instance_isolation"], true);
}

#[test]
fn source_exports_cannot_take_private_activation_names() {
    let mut p = fixture();
    for name in ["$nts$activation$enter", "$nts$activation$user"] {
        p.public_api[0].1 = name.into();
        let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
        assert!(
            error.contains(name) && error.contains("reserved"),
            "{error}"
        );
    }
}

#[test]
fn module_initialization_uses_the_same_throw_and_cleanup_contract() {
    let mut p = fixture();
    let mut init = function(nts_core::hir::lower::MODULE_INIT, &[], HirType::Void);
    init.exported = false;
    let mut ops = vec![];
    let message = op(
        &mut init,
        &mut ops,
        OpKind::ConstString("init payload".into()),
        string(),
    );
    let payload = erase(&mut init, &mut ops, message);
    call(
        &mut init,
        &mut ops,
        "nts_raise",
        vec![payload],
        HirType::Void,
    );
    init.blocks.push(block(&[], &ops, Terminator::Return(None)));
    p.funcs.push(init);
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    let report = common::run(
        "raising-init",
        &emitted,
        "tooling/wasm/check-raising.mjs",
        &[],
    );
    assert_eq!(report["init_cleanup"], true);
}

#[test]
fn unsupported_raising_signatures_refuse_by_exact_helper_name() {
    let mut f = function("wrongRaise", &[F64], HirType::Void);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    call(&mut f, &mut ops, "nts_raise", vec![input], HirType::Void);
    f.blocks.push(block(&[], &ops, Terminator::Return(None)));
    let error = nts_codegen_wasm::emit(&program(vec![f]))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("wrongRaise") && error.contains("nts_raise"),
        "{error}"
    );
}

#[test]
fn parameter_values_exist_even_without_block_pseudo_ops() {
    let mut f = function("entryParameter", &[F64], F64);
    let param = value(&mut f, OpKind::Param(0), F64);
    f.blocks
        .push(block(&[], &[], Terminator::Return(Some(param))));
    nts_codegen_wasm::emit(&program(vec![f])).unwrap();
}
