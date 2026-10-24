//! Closure entries have a real common base, separate slots and exact captures.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, block, function, program, value};
use nts_core::hir::{
    Absent, BinOp, BlockId, Callee, ClassId, Field, Func, HirType, Layout, ManagedType, OpKind,
    Program, Terminator, ValueId,
};

const ROOT: u32 = 100;
const FIRST: u32 = nts_core::hir::SYNTHETIC_CLOSURES + 1;
const SECOND: u32 = FIRST + 1;
const STATIC: u32 = FIRST + 2;
const SLOT: u32 = 5;
const OTHER: u32 = 6;
fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(id)))
}
fn op(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
fn finish(mut f: Func, ops: Vec<ValueId>, result: ValueId) -> Func {
    f.blocks.push(nts_core::hir::Block {
        params: vec![],
        ops,
        terminator: Terminator::Return(Some(result)),
    });
    f
}
fn field(name: &str, ty: HirType) -> Field {
    Field {
        name: name.into(),
        ty,
        written: None,
        declared_by: None,
        readonly: true,
    }
}
fn layout(id: u32, name: &str, fields: Vec<Field>, methods: &[&str], base: Option<u32>) -> Layout {
    let mut slots = vec![None; SLOT as usize];
    slots.extend(methods.iter().map(|s| Some((*s).into())));
    Layout {
        types: vec![ClassId(id)],
        name: name.into(),
        fields,
        methods: slots,
        interfaces: vec![],
        base: base.map(ClassId),
    }
}
fn body(name: &str, class: u32, operator: BinOp, static_: bool) -> Func {
    let mut f = function(name, &[object(class), F64], F64);
    f.exported = false;
    let mut ops = vec![];
    let receiver = op(&mut f, &mut ops, OpKind::Param(0), object(class));
    let input = op(&mut f, &mut ops, OpKind::Param(1), F64);
    let capture = if static_ {
        op(&mut f, &mut ops, OpKind::ConstFloat(2.0), F64)
    } else {
        op(
            &mut f,
            &mut ops,
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            F64,
        )
    };
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: operator,
            lhs: capture,
            rhs: input,
        },
        F64,
    );
    finish(f, ops, result)
}
fn allocate(f: &mut Func, ops: &mut Vec<ValueId>, class: u32, capture: ValueId) -> ValueId {
    let closure = op(f, ops, OpKind::ObjectNew { frame: false }, object(class));
    op(
        f,
        ops,
        OpKind::FieldSet {
            object: closure,
            field: 0,
            value: capture,
        },
        HirType::Void,
    );
    closure
}
fn call(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    receiver: ValueId,
    input: ValueId,
    slot: u32,
) -> ValueId {
    op(
        f,
        ops,
        OpKind::Call {
            callee: Callee::Closure { slot },
            args: vec![receiver, input],
            frame: None,
        },
        F64,
    )
}
fn direct(class: u32, erased: bool, slot: u32) -> Func {
    let mut f = function(&format!("call_{class}_{erased}_{slot}"), &[F64, F64], F64);
    let mut ops = vec![];
    let capture = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let input = op(&mut f, &mut ops, OpKind::Param(1), F64);
    let mut receiver = allocate(&mut f, &mut ops, class, capture);
    if erased {
        let value = op(
            &mut f,
            &mut ops,
            OpKind::Erase {
                value: receiver,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        );
        receiver = op(&mut f, &mut ops, OpKind::unerase(value), object(ROOT));
    }
    let result = call(&mut f, &mut ops, receiver, input, slot);
    finish(f, ops, result)
}
fn merged() -> Func {
    let mut f = function("merged", &[HirType::Bool, F64, F64], F64);
    let mut entry = vec![];
    let choose = op(&mut f, &mut entry, OpKind::Param(0), HirType::Bool);
    let capture = op(&mut f, &mut entry, OpKind::Param(1), F64);
    let input = op(&mut f, &mut entry, OpKind::Param(2), F64);
    let left = allocate(&mut f, &mut entry, FIRST, capture);
    let right = allocate(&mut f, &mut entry, SECOND, capture);
    let receiver = value(&mut f, OpKind::BlockParam(0), object(ROOT));
    f.blocks.push(block(
        &[],
        &entry,
        Terminator::Branch {
            cond: choose,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    ));
    f.blocks.push(block(
        &[],
        &[],
        Terminator::Jump {
            target: BlockId(3),
            args: vec![left],
        },
    ));
    f.blocks.push(block(
        &[],
        &[],
        Terminator::Jump {
            target: BlockId(3),
            args: vec![right],
        },
    ));
    let mut ops = vec![];
    let result = call(&mut f, &mut ops, receiver, input, SLOT);
    f.blocks
        .push(block(&[receiver], &ops, Terminator::Return(Some(result))));
    f
}
fn identity(name: &str, static_: bool) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = vec![];
    let kind = if static_ {
        OpKind::ClosureStatic
    } else {
        OpKind::ObjectNew { frame: false }
    };
    let left = op(&mut f, &mut ops, kind.clone(), object(STATIC));
    let right = op(&mut f, &mut ops, kind, object(STATIC));
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: left,
            rhs: right,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn static_call() -> Func {
    let mut f = function("staticCall", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = op(&mut f, &mut ops, OpKind::ClosureStatic, object(STATIC));
    let result = call(&mut f, &mut ops, receiver, input, SLOT);
    finish(f, ops, result)
}
fn null_call() -> Func {
    let mut f = function("nullCall", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = op(&mut f, &mut ops, OpKind::ConstNull, object(ROOT));
    let result = call(&mut f, &mut ops, receiver, input, SLOT);
    finish(f, ops, result)
}
fn tag() -> Func {
    let mut f = function("functionTag", &[], I32);
    let mut ops = vec![];
    let receiver = op(&mut f, &mut ops, OpKind::ClosureStatic, object(STATIC));
    let erased = op(
        &mut f,
        &mut ops,
        OpKind::Erase {
            value: receiver,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let result = op(&mut f, &mut ops, OpKind::TagOf { value: erased }, I32);
    finish(f, ops, result)
}
fn captured_string(p: &mut Program) {
    let ty = HirType::Managed(ManagedType::String);
    let signature = ROOT + 1;
    let capture = STATIC + 1;
    let mut body = function("bodyString", &[object(capture)], ty.clone());
    body.exported = false;
    let mut ops = vec![];
    let receiver = op(&mut body, &mut ops, OpKind::Param(0), object(capture));
    let result = op(
        &mut body,
        &mut ops,
        OpKind::FieldGet {
            object: receiver,
            field: 0,
        },
        ty.clone(),
    );
    p.funcs.push(finish(body, ops, result));
    let mut declaration = function("signatureString", &[object(signature)], ty.clone());
    declaration.abstract_declaration = true;
    declaration.exported = false;
    declaration
        .blocks
        .push(block(&[], &[], Terminator::Unreachable));
    p.funcs.push(declaration);
    let mut f = function("capturedString", std::slice::from_ref(&ty), ty.clone());
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), ty.clone());
    let closure = allocate(&mut f, &mut ops, capture, input);
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Closure { slot: SLOT },
            args: vec![closure],
            frame: None,
        },
        ty.clone(),
    );
    p.funcs.push(finish(f, ops, result));
    p.public_api
        .push(("capturedString".into(), "capturedString".into()));
    p.layouts.extend([
        layout(
            signature,
            "StringSignature",
            vec![],
            &["signatureString"],
            None,
        ),
        layout(
            capture,
            "StringCaptures",
            vec![field("text", ty)],
            &["bodyString"],
            Some(signature),
        ),
    ]);
}
fn global(p: &mut Program) {
    p.globals.push(nts_core::hir::Global {
        name: "internal".into(),
        ty: F64,
        written: None,
        constant: true,
        initial: 17.0,
        exported: false,
        deferred: false,
        origin: common::hir::origin(),
    });
    let mut f = function("global", &[], F64);
    let mut ops = vec![];
    let result = op(&mut f, &mut ops, OpKind::GlobalGet(0), F64);
    p.funcs.push(finish(f, ops, result));
    p.public_api.push(("global".into(), "global".into()));
}
fn fixture() -> Program {
    let mut funcs = vec![
        body("bodyFirst", FIRST, BinOp::Add, false),
        body("bodyFirstOther", FIRST, BinOp::Mul, false),
        body("bodySecond", SECOND, BinOp::Sub, false),
        body("bodySecondOther", SECOND, BinOp::Div, false),
        body("bodyStatic", STATIC, BinOp::Mul, true),
        body("bodyStaticOther", STATIC, BinOp::Add, true),
    ];
    for name in ["signatureCall", "signatureOther"] {
        let mut declaration = function(name, &[object(ROOT), F64], F64);
        declaration.abstract_declaration = true;
        declaration.exported = false;
        declaration
            .blocks
            .push(block(&[], &[], Terminator::Unreachable));
        funcs.push(declaration);
    }
    for class in [FIRST, SECOND] {
        for erased in [false, true] {
            for slot in [SLOT, OTHER] {
                funcs.push(direct(class, erased, slot));
            }
        }
    }
    funcs.extend([
        merged(),
        static_call(),
        identity("namedIdentity", true),
        identity("freshIdentity", false),
        null_call(),
        tag(),
    ]);
    let mut p = program(funcs);
    p.public_api
        .retain(|(_, name)| !name.starts_with("body") && !name.starts_with("signature"));
    p.layouts = vec![
        layout(
            ROOT,
            "WrittenSignature",
            vec![],
            &["signatureCall", "signatureOther"],
            None,
        ),
        layout(
            FIRST,
            "FirstCaptures",
            vec![field("number", F64), field("recursive", object(FIRST))],
            &["bodyFirst", "bodyFirstOther"],
            Some(ROOT),
        ),
        layout(
            SECOND,
            "SecondCaptures",
            vec![
                field("number", F64),
                field("text", HirType::Managed(ManagedType::String)),
            ],
            &["bodySecond", "bodySecondOther"],
            Some(ROOT),
        ),
        layout(
            STATIC,
            "NamedFunction",
            vec![],
            &["bodyStatic", "bodyStaticOther"],
            Some(ROOT),
        ),
    ];
    captured_string(&mut p);
    global(&mut p);
    p
}
#[test]
fn closures_keep_capture_type_entry_and_identity() {
    let p = fixture();
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    nts_codegen_wasm::validate(&emitted.bytes).unwrap();
    let result = common::run("closures", &emitted, "tooling/wasm/check-closures.mjs", &[]);
    assert!(result["cases"].as_u64().unwrap() > 1000);
    assert_eq!(result["named_declines"], 1);
}
#[test]
fn unfilled_callable_slot_is_named_and_has_no_artifact() {
    let mut p = fixture();
    p.layouts[1].methods[SLOT as usize] = None;
    let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
    assert!(
        error.contains("NTS5001")
            && error.contains("FirstCaptures")
            && error.contains("unfilled slot 5"),
        "{error}"
    );
}

#[test]
fn an_incompatible_callable_slot_declines_instead_of_retyping_it() {
    let mut p = fixture();
    let mut wrong = function("wrongSlot", &[object(SECOND), HirType::Bool], F64);
    wrong.exported = false;
    let mut ops = vec![];
    let input = op(&mut wrong, &mut ops, OpKind::Param(1), HirType::Bool);
    let result = op(&mut wrong, &mut ops, OpKind::Convert(input), F64);
    p.funcs.push(finish(wrong, ops, result));
    p.layouts[2].methods[SLOT as usize] = Some("wrongSlot".into());
    let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
    assert!(
        error.contains("NTS5001")
            && error.contains("wrongSlot")
            && error.contains("incompatible with slot 5"),
        "{error}"
    );
}
#[test]
fn a_missing_declared_common_signature_declines_by_name() {
    let mut p = fixture();
    p.layouts[0].methods[SLOT as usize] = None;
    let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
    assert!(
        error.contains("NTS5001")
            && error.contains("WrittenSignature")
            && error.contains("declares no entry at slot 5"),
        "{error}"
    );
}
