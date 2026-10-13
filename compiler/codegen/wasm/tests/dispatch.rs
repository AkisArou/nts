//! Descriptor dispatch uses authoritative class entries, including inherited bodies.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, function, program, value};
use nts_core::hir::{
    Absent, BinOp, Callee, ClassId, ClassIdentity, Field, Func, HirType, Layout, ManagedType,
    OpKind, Program, Terminator, ValueId,
};

const ROOT: u32 = 10;
const CHILD: u32 = 11;
const SIBLING: u32 = 12;
const OTHER: u32 = 14;
const SLOT: u32 = 2;
const SECOND: u32 = 3;
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
fn body(name: &str, class: u32, operator: BinOp) -> Func {
    let mut f = function(name, &[object(class), F64], F64);
    f.exported = false;
    let mut ops = vec![];
    let receiver = op(&mut f, &mut ops, OpKind::Param(0), object(class));
    let input = op(&mut f, &mut ops, OpKind::Param(1), F64);
    let field = op(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: receiver,
            field: 0,
        },
        F64,
    );
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: operator,
            lhs: field,
            rhs: input,
        },
        F64,
    );
    finish(f, ops, result)
}
fn allocate(f: &mut Func, ops: &mut Vec<ValueId>, class: u32, input: ValueId) -> ValueId {
    let receiver = op(f, ops, OpKind::ObjectNew { frame: false }, object(class));
    op(
        f,
        ops,
        OpKind::FieldSet {
            object: receiver,
            field: 0,
            value: input,
        },
        HirType::Void,
    );
    receiver
}
fn call(class: u32, slot: u32, widened: bool, erased: bool) -> Func {
    let mut f = function(
        &format!("call_{class}_{slot}_{widened}_{erased}"),
        &[F64, F64],
        F64,
    );
    let mut ops = vec![];
    let capture = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let input = op(&mut f, &mut ops, OpKind::Param(1), F64);
    let mut receiver = allocate(&mut f, &mut ops, class, capture);
    let target = if widened { ROOT } else { class };
    if erased {
        let value = op(
            &mut f,
            &mut ops,
            OpKind::Erase {
                value: receiver,
                absent: Absent::Impossible,
            },
            HirType::Erased,
        );
        receiver = op(&mut f, &mut ops, OpKind::Unerase { value }, object(target));
    } else if widened {
        receiver = op(&mut f, &mut ops, OpKind::Convert(receiver), object(ROOT));
    }
    let declared = if class == OTHER {
        "bodyOther"
    } else {
        "bodyRoot"
    };
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Virtual {
                slot,
                declared: declared.into(),
            },
            args: vec![receiver, input],
            frame: None,
        },
        F64,
    );
    finish(f, ops, result)
}
fn nominal() -> Func {
    let mut f = function("nominal", &[F64], HirType::Bool);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = allocate(&mut f, &mut ops, OTHER, input);
    let result = op(
        &mut f,
        &mut ops,
        OpKind::InstanceOf {
            value: receiver,
            classes: vec![ClassId(ROOT)],
            by_layout: false,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn null_call() -> Func {
    let mut f = function("nullCall", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = op(&mut f, &mut ops, OpKind::ConstNull, object(ROOT));
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Virtual {
                slot: SLOT,
                declared: "bodyRoot".into(),
            },
            args: vec![receiver, input],
            frame: None,
        },
        F64,
    );
    finish(f, ops, result)
}
fn self_body(name: &str, class: u32) -> Func {
    let mut f = function(name, &[object(class), F64], object(class));
    f.exported = false;
    let mut ops = vec![];
    let receiver = op(&mut f, &mut ops, OpKind::Param(0), object(class));
    finish(f, ops, receiver)
}
fn covariant() -> Func {
    let mut f = function("covariant", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = allocate(&mut f, &mut ops, CHILD, input);
    let receiver = op(&mut f, &mut ops, OpKind::Convert(receiver), object(ROOT));
    let returned = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Virtual {
                slot: SECOND + 1,
                declared: "bodyRootSelf".into(),
            },
            args: vec![receiver, input],
            frame: None,
        },
        object(ROOT),
    );
    let result = op(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: returned,
            field: 0,
        },
        F64,
    );
    finish(f, ops, result)
}
fn covariant_proof(name: &str, identity: bool) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::ConstFloat(13.0), F64);
    let receiver = allocate(&mut f, &mut ops, CHILD, input);
    let receiver = op(&mut f, &mut ops, OpKind::Convert(receiver), object(ROOT));
    let returned = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Virtual {
                slot: SECOND + 1,
                declared: "bodyRootSelf".into(),
            },
            args: vec![receiver, input],
            frame: None,
        },
        object(ROOT),
    );
    let kind = if identity {
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: receiver,
            rhs: returned,
        }
    } else {
        OpKind::InstanceOf {
            value: returned,
            classes: vec![ClassId(CHILD)],
            by_layout: false,
        }
    };
    let result = op(&mut f, &mut ops, kind, HirType::Bool);
    finish(f, ops, result)
}
fn fixture() -> Program {
    let mut funcs = vec![
        body("bodyRoot", ROOT, BinOp::Add),
        body("bodyRootSecond", ROOT, BinOp::Mul),
        body("bodyChild", CHILD, BinOp::Sub),
        body("bodySibling", SIBLING, BinOp::Mul),
        body("bodySiblingSecond", SIBLING, BinOp::Div),
        body("bodyOther", OTHER, BinOp::Div),
        body("bodyOtherSecond", OTHER, BinOp::Sub),
        nominal(),
        null_call(),
        self_body("bodyRootSelf", ROOT),
        self_body("bodyChildSelf", CHILD),
        covariant(),
        covariant_proof("covariantIdentity", true),
        covariant_proof("covariantClass", false),
    ];
    for class in [ROOT, CHILD, SIBLING, OTHER] {
        for slot in [SLOT, SECOND] {
            for erased in [false, true] {
                funcs.push(call(class, slot, false, erased));
                if class == CHILD || class == SIBLING {
                    funcs.push(call(class, slot, true, erased));
                }
            }
        }
    }
    let mut p = program(funcs);
    p.public_api.retain(|(_, name)| !name.starts_with("body"));
    let fields = vec![field("number", F64), field("recursive", object(ROOT))];
    let mut derived = fields.clone();
    derived.push(field("text", HirType::Managed(ManagedType::String)));
    p.layouts = vec![
        layout(
            ROOT,
            "Root",
            fields.clone(),
            &["bodyRoot", "bodyRootSecond", "bodyRootSelf"],
            None,
        ),
        layout(
            CHILD,
            "Child",
            derived,
            &["bodyChild", "bodyRootSecond", "bodyChildSelf"],
            Some(ROOT),
        ),
        layout(
            SIBLING,
            "Sibling",
            fields.clone(),
            &["bodySibling", "bodySiblingSecond", "bodyRootSelf"],
            Some(ROOT),
        ),
        layout(
            OTHER,
            "OtherEqualStorage",
            fields,
            &["bodyOther", "bodyOtherSecond"],
            None,
        ),
    ];
    for (id, name) in [
        (ROOT, "Root"),
        (CHILD, "Child"),
        (SIBLING, "Sibling"),
        (OTHER, "OtherEqualStorage"),
    ] {
        p.classes.push(ClassIdentity {
            symbol: id + 100,
            name: name.into(),
            types: vec![ClassId(id)],
        });
    }
    p
}
#[test]
fn class_slots_dispatch_overrides_and_inherited_bodies() {
    let p = fixture();
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    nts_codegen_wasm::validate(&emitted.bytes).unwrap();
    let result = common::run("dispatch", &emitted, "tooling/wasm/check-dispatch.mjs", &[]);
    assert!(result["cases"].as_u64().unwrap() > 1000);
    assert_eq!(result["named_declines"], 1);
}
#[test]
fn unfilled_class_slot_is_a_named_decline() {
    let mut p = fixture();
    p.layouts[1].methods[SECOND as usize] = None;
    let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
    assert!(
        error.contains("NTS5001") && error.contains("Child") && error.contains("unfilled slot 3"),
        "{error}"
    );
}

#[test]
fn conflicting_declared_virtual_signature_is_not_silently_converted() {
    let mut p = fixture();
    let narrow = HirType::Float { bits: 32 };
    let mut declared = function(
        "conflictingDeclaration",
        &[object(ROOT), F64],
        narrow.clone(),
    );
    declared.exported = false;
    let mut ops = vec![];
    let result = op(
        &mut declared,
        &mut ops,
        OpKind::ConstFloat(2.0),
        narrow.clone(),
    );
    p.funcs.push(finish(declared, ops, result));
    let mut f = function("conflictingCall", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let receiver = allocate(&mut f, &mut ops, ROOT, input);
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Call {
            callee: Callee::Virtual {
                slot: SLOT,
                declared: "conflictingDeclaration".into(),
            },
            args: vec![receiver, input],
            frame: None,
        },
        narrow,
    );
    let result = op(&mut f, &mut ops, OpKind::Convert(result), F64);
    p.funcs.push(finish(f, ops, result));
    p.public_api
        .push(("conflictingCall".into(), "conflictingCall".into()));
    let error = nts_codegen_wasm::emit(&p).unwrap_err().to_string();
    assert!(
        error.contains("NTS5001")
            && error.contains("conflictingDeclaration")
            && error.contains("common signature"),
        "{error}"
    );
}
