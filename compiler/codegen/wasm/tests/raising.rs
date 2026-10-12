//! Source throws reach JS as their actual values, and no exit to the host
//! leaves a pending raise behind for a later call.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, block, function, program, value};
use nts_core::hir::{
    Absent, BinOp, BlockId, Callee, ClassId, Func, HirType, Layout, ManagedType, OpKind,
    Terminator, ValueId,
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
fn call_to(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    callee: Callee,
    args: Vec<ValueId>,
    ty: HirType,
) -> ValueId {
    op(
        f,
        ops,
        OpKind::Call {
            callee,
            args,
            frame: None,
        },
        ty,
    )
}
fn call(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    name: &str,
    args: Vec<ValueId>,
    ty: HirType,
) -> ValueId {
    call_to(f, ops, Callee::External(name.into()), args, ty)
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
fn payload(f: &mut Func, ops: &mut Vec<ValueId>, ty: Option<&HirType>, null: bool) -> ValueId {
    if let Some(ty) = ty {
        let input = op(f, ops, OpKind::Param(0), ty.clone());
        erase(f, ops, input)
    } else {
        op(
            f,
            ops,
            if null {
                OpKind::ConstNull
            } else {
                OpKind::ConstUndefined
            },
            HirType::Erased,
        )
    }
}
/// Throw an erased value out of an ordinary function, as lowering does.
fn uncaught(f: &mut Func, ops: &mut Vec<ValueId>, thrown: ValueId) {
    let detail = op(f, ops, OpKind::ConstNull, string());
    call(f, ops, "nts_uncaught", vec![thrown, detail], HirType::Void);
}
/// `uncaught{Kind}` throws directly. `raise{Kind}` has the shape lowering
/// gives a call that may throw: the public entry calls its raising copy, tests
/// the flag, then takes the payload and throws it uncaught.
fn thrown(name: &str, ty: Option<&HirType>, raising: bool, null: bool) -> Vec<Func> {
    let params: Vec<_> = ty.into_iter().cloned().collect();
    if !raising {
        let mut f = function(name, &params, string());
        let mut ops = vec![];
        let value = payload(&mut f, &mut ops, ty, null);
        uncaught(&mut f, &mut ops, value);
        f.blocks.push(block(&[], &ops, Terminator::Unreachable));
        return vec![f];
    }
    let copy_name = format!("{name}@raises");
    let mut copy = function(&copy_name, &params, string());
    copy.exported = false;
    let mut ops = vec![];
    let value = payload(&mut copy, &mut ops, ty, null);
    call(&mut copy, &mut ops, "nts_raise", vec![value], HirType::Void);
    let placeholder = op(&mut copy, &mut ops, OpKind::ConstNull, string());
    copy.blocks
        .push(block(&[], &ops, Terminator::Return(Some(placeholder))));
    let mut entry = function(name, &params, string());
    let mut ops = vec![];
    let args = if let Some(ty) = ty {
        vec![op(&mut entry, &mut ops, OpKind::Param(0), ty.clone())]
    } else {
        vec![]
    };
    let result = call_to(
        &mut entry,
        &mut ops,
        Callee::Direct(copy_name),
        args,
        string(),
    );
    let raised = call(&mut entry, &mut ops, "nts_raising", vec![], HirType::Bool);
    entry.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond: raised,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    ));
    let mut ops = vec![];
    let taken = call(
        &mut entry,
        &mut ops,
        "nts_raise_take",
        vec![],
        HirType::Erased,
    );
    uncaught(&mut entry, &mut ops, taken);
    entry.blocks.push(block(&[], &ops, Terminator::Unreachable));
    entry
        .blocks
        .push(block(&[], &[], Terminator::Return(Some(result))));
    vec![copy, entry]
}
fn pending() -> Func {
    let mut f = function("pending", &[], I32);
    let mut ops = vec![];
    let flag = call(&mut f, &mut ops, "nts_raising", vec![], I32);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(flag))));
    f
}
/// An object thrown uncaught keeps its named refusal. Raised and caught, it
/// keeps its identity: the entry allocates it, its raising copy raises it, and
/// the entry takes the payload back and compares.
fn uncaught_object() -> Func {
    let mut f = function("uncaughtObject", &[], HirType::Bool);
    let mut ops = vec![];
    let object = op(
        &mut f,
        &mut ops,
        OpKind::ObjectNew { frame: false },
        object(),
    );
    let payload = erase(&mut f, &mut ops, object);
    uncaught(&mut f, &mut ops, payload);
    f.blocks.push(block(&[], &ops, Terminator::Unreachable));
    f
}
fn caught_object() -> Vec<Func> {
    let mut copy = function("caughtObject@raises", &[object()], HirType::Bool);
    copy.exported = false;
    let mut ops = vec![];
    let input = op(&mut copy, &mut ops, OpKind::Param(0), object());
    let payload = erase(&mut copy, &mut ops, input);
    call(
        &mut copy,
        &mut ops,
        "nts_raise",
        vec![payload],
        HirType::Void,
    );
    let placeholder = op(&mut copy, &mut ops, OpKind::ConstBool(false), HirType::Bool);
    copy.blocks
        .push(block(&[], &ops, Terminator::Return(Some(placeholder))));
    let mut entry = function("caughtObject", &[], HirType::Bool);
    let mut ops = vec![];
    let allocated = op(
        &mut entry,
        &mut ops,
        OpKind::ObjectNew { frame: false },
        object(),
    );
    call_to(
        &mut entry,
        &mut ops,
        Callee::Direct("caughtObject@raises".into()),
        vec![allocated],
        HirType::Bool,
    );
    let taken = call(
        &mut entry,
        &mut ops,
        "nts_raise_take",
        vec![],
        HirType::Erased,
    );
    let expected = erase(&mut entry, &mut ops, allocated);
    let identity = op(
        &mut entry,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: taken,
            rhs: expected,
        },
        HirType::Bool,
    );
    entry
        .blocks
        .push(block(&[], &ops, Terminator::Return(Some(identity))));
    vec![copy, entry]
}
/// A host entry that records a raise and returns, which lowering never emits:
/// the raise must reach JS as a throw, not be lost or seen by the next call.
fn leaky() -> Func {
    let mut f = function("leaky", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let payload = erase(&mut f, &mut ops, input);
    call(&mut f, &mut ops, "nts_raise", vec![payload], HirType::Void);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(input))));
    f
}
/// A raise left pending when an input refusal leaves wasm: the raising copy
/// records a raise, then refuses an input before returning to its caller. The
/// refusal must clear the raise, or the next call would observe it.
fn refusal() -> Vec<Func> {
    let mut copy = function("refusal@raises", &[F64], F64);
    copy.exported = false;
    let mut ops = vec![];
    let input = op(&mut copy, &mut ops, OpKind::Param(0), F64);
    let payload = erase(&mut copy, &mut ops, input);
    call(
        &mut copy,
        &mut ops,
        "nts_raise",
        vec![payload],
        HirType::Void,
    );
    let null = op(&mut copy, &mut ops, OpKind::ConstNull, string());
    let length = op(&mut copy, &mut ops, OpKind::Length(null), F64);
    copy.blocks
        .push(block(&[], &ops, Terminator::Return(Some(length))));
    let mut entry = function("refusal", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut entry, &mut ops, OpKind::Param(0), F64);
    let result = call_to(
        &mut entry,
        &mut ops,
        Callee::Direct("refusal@raises".into()),
        vec![input],
        F64,
    );
    let raised = call(&mut entry, &mut ops, "nts_raising", vec![], HirType::Bool);
    entry.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond: raised,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    ));
    let mut ops = vec![];
    let taken = call(
        &mut entry,
        &mut ops,
        "nts_raise_take",
        vec![],
        HirType::Erased,
    );
    uncaught(&mut entry, &mut ops, taken);
    entry.blocks.push(block(&[], &ops, Terminator::Unreachable));
    entry
        .blocks
        .push(block(&[], &[], Terminator::Return(Some(result))));
    vec![copy, entry]
}
fn fixture() -> nts_core::hir::Program {
    let mut funcs = vec![pending(), uncaught_object(), leaky()];
    funcs.extend(caught_object());
    funcs.extend(refusal());
    for raising in [true, false] {
        let prefix = if raising { "raise" } else { "uncaught" };
        for (suffix, ty, null) in [
            ("Number", Some(F64), false),
            ("Boolean", Some(HirType::Bool), false),
            ("String", Some(string()), false),
            ("Undefined", None, false),
            ("Null", None, true),
        ] {
            funcs.extend(thrown(
                &format!("{prefix}{suffix}"),
                ty.as_ref(),
                raising,
                null,
            ));
        }
    }
    let mut p = program(funcs);
    p.public_api.retain(|(name, _)| !name.ends_with("@raises"));
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
fn source_throws_reach_js_as_values_and_leave_no_pending_raise() {
    let emitted = nts_codegen_wasm::emit(&fixture()).unwrap();
    // The thrown value crosses through WebAssembly.JSTag: no activation
    // exports, no per-call bookkeeping, no throw-per-kind imports.
    assert!(emitted.manifest.features.iter().any(|f| f == "exceptions"));
    let report = common::run("raising", &emitted, "tooling/wasm/check-raising.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 100);
    assert_eq!(report["stale_state_cleared"], true);
    assert_eq!(report["instance_isolation"], true);
}

#[test]
fn a_module_initializer_throw_rejects_the_import_with_its_value() {
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
    uncaught(&mut init, &mut ops, payload);
    init.blocks.push(block(&[], &ops, Terminator::Unreachable));
    p.funcs.push(init);
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    let report = common::run(
        "raising-init",
        &emitted,
        "tooling/wasm/check-raising.mjs",
        &[],
    );
    assert_eq!(report["init_throw"], true);
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

/// The host-entry check for a pending raise is keyed on a body recording
/// one: a module that only throws uncaught takes no payload anywhere, and one
/// that records a raise checks at its entries.
#[test]
fn only_a_recorded_raise_costs_the_host_entry_check() {
    let named = |bytes: &[u8], name: &[u8]| bytes.windows(name.len()).any(|w| w == name);
    // An export that returns, beside one that throws uncaught: only a
    // return can carry the check.
    let mut returns = function("identity", &[F64], F64);
    let input = value(&mut returns, OpKind::Param(0), F64);
    returns
        .blocks
        .push(block(&[], &[input], Terminator::Return(Some(input))));
    let mut funcs = thrown("uncaughtNumber", Some(&F64), false, false);
    funcs.push(returns);
    let uncaught_only = program(funcs);
    let emitted = nts_codegen_wasm::emit(&uncaught_only).unwrap();
    assert!(!named(&emitted.bytes, b"raise.take"));
    let recorded = program(vec![leaky()]);
    let emitted = nts_codegen_wasm::emit(&recorded).unwrap();
    assert!(named(&emitted.bytes, b"raise.take"));
}
