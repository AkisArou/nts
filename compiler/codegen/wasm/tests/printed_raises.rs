//! The runtime half of a raising program printer, independent of source
//! lowering: core's selected entry returns a null String with a pending raise.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{I32, U32, block, function, origin, program, value};
use nts_core::hir::{
    Absent, ArrayFill, BinOp, BlockId, Callee, ClassId, ClassIdentity, Field, Func, Global,
    HirType, Layout, ManagedType, OpKind, Printed, Program, Terminator, ValueId,
};

const TRACE: u32 = 0;
const FIRST_TRACE: u32 = 1;
const CAUGHT: u32 = 2;
const FAIL_ONCE: u32 = 3;
const CAUGHT_PAYLOAD: u32 = 4;
// Deliberately unrelated to either the ordinary method or an @raises suffix.
const SELECTED: &str = "chosen_printer_without_a_naming_convention";

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}
fn object() -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(1)))
}
fn array() -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(HirType::Erased)))
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
fn set(f: &mut Func, ops: &mut Vec<ValueId>, global: u32, value: ValueId) {
    op(f, ops, OpKind::GlobalSet { global, value }, HirType::Void);
}
fn erase(f: &mut Func, ops: &mut Vec<ValueId>, value: ValueId) -> ValueId {
    op(
        f,
        ops,
        OpKind::Erase {
            value,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    )
}
fn field(f: &mut Func, ops: &mut Vec<ValueId>, object: ValueId, at: u32, ty: HirType) -> ValueId {
    op(f, ops, OpKind::FieldGet { object, field: at }, ty)
}
fn binary(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    operation: BinOp,
    lhs: ValueId,
    rhs: ValueId,
    ty: HirType,
) -> ValueId {
    op(
        f,
        ops,
        OpKind::Binary {
            op: operation,
            lhs,
            rhs,
        },
        ty,
    )
}

fn printer() -> Func {
    let mut f = function(SELECTED, &[object()], string());
    f.exported = false;
    let mut ops = vec![];
    let receiver = op(&mut f, &mut ops, OpKind::Param(0), object());
    let marker = field(&mut f, &mut ops, receiver, 0, I32);
    let trace = op(&mut f, &mut ops, OpKind::GlobalGet(TRACE), I32);
    let ten = op(&mut f, &mut ops, OpKind::ConstInt(10), I32);
    let shifted = binary(&mut f, &mut ops, BinOp::Mul, trace, ten, I32);
    let next = binary(&mut f, &mut ops, BinOp::Add, shifted, marker, I32);
    set(&mut f, &mut ops, TRACE, next);
    let fails = field(&mut f, &mut ops, receiver, 2, HirType::Bool);
    f.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond: fails,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(3),
            else_args: vec![],
        },
    ));
    let mut ops = vec![];
    let pending = op(
        &mut f,
        &mut ops,
        OpKind::GlobalGet(FAIL_ONCE),
        HirType::Bool,
    );
    f.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond: pending,
            then_target: BlockId(2),
            then_args: vec![],
            else_target: BlockId(3),
            else_args: vec![],
        },
    ));
    let mut ops = vec![];
    let no = op(&mut f, &mut ops, OpKind::ConstBool(false), HirType::Bool);
    set(&mut f, &mut ops, FAIL_ONCE, no);
    let payload = field(&mut f, &mut ops, receiver, 3, HirType::Erased);
    call(&mut f, &mut ops, "nts_raise", vec![payload], HirType::Void);
    let placeholder = op(&mut f, &mut ops, OpKind::ConstNull, string());
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(placeholder))));
    let mut ops = vec![];
    let text = field(&mut f, &mut ops, receiver, 1, string());
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(text))));
    f
}

fn printer_object(
    f: &mut Func,
    ops: &mut Vec<ValueId>,
    marker: i128,
    text: &str,
    payload: ValueId,
) -> ValueId {
    let receiver = op(f, ops, OpKind::ObjectNew { frame: false }, object());
    let marker_value = op(f, ops, OpKind::ConstInt(marker), I32);
    let text = op(f, ops, OpKind::ConstString(text.into()), string());
    let fails = op(f, ops, OpKind::ConstBool(marker == 2), HirType::Bool);
    for (at, value) in [marker_value, text, fails, payload].into_iter().enumerate() {
        op(
            f,
            ops,
            OpKind::FieldSet {
                object: receiver,
                field: u32::try_from(at).unwrap(),
                value,
            },
            HirType::Void,
        );
    }
    erase(f, ops, receiver)
}
fn set_element(f: &mut Func, ops: &mut Vec<ValueId>, array: ValueId, at: usize, value: ValueId) {
    let index = op(f, ops, OpKind::ConstInt(i128::try_from(at).unwrap()), U32);
    op(
        f,
        ops,
        OpKind::ArraySet {
            array,
            index,
            value,
            checked: true,
        },
        HirType::Void,
    );
}
fn array_of(f: &mut Func, ops: &mut Vec<ValueId>, elements: &[ValueId], cycle: bool) -> ValueId {
    let len = op(
        f,
        ops,
        OpKind::ConstInt(i128::try_from(elements.len() + usize::from(cycle)).unwrap()),
        U32,
    );
    let array = op(
        f,
        ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(),
    );
    let erased = erase(f, ops, array);
    for (at, &element) in elements.iter().enumerate() {
        set_element(f, ops, array, at + usize::from(cycle && at > 0), element);
    }
    if cycle {
        set_element(f, ops, array, 1, erased);
    }
    erased
}

fn entry(name: &str, shape: &str, object_payload: bool) -> Func {
    let params = if object_payload {
        vec![HirType::Bool]
    } else {
        vec![HirType::Erased, HirType::Bool]
    };
    let mut f = function(name, &params, string());
    let mut ops = vec![];
    let payload = if object_payload {
        let unused = op(&mut f, &mut ops, OpKind::ConstUndefined, HirType::Erased);
        printer_object(&mut f, &mut ops, 9, "payload must not print", unused)
    } else {
        op(&mut f, &mut ops, OpKind::Param(0), HirType::Erased)
    };
    let fail = op(
        &mut f,
        &mut ops,
        OpKind::Param(u32::from(!object_payload)),
        HirType::Bool,
    );
    set(&mut f, &mut ops, FAIL_ONCE, fail);
    let zero = op(&mut f, &mut ops, OpKind::ConstInt(0), I32);
    set(&mut f, &mut ops, TRACE, zero);
    let minus_one = op(&mut f, &mut ops, OpKind::ConstInt(-1), I32);
    set(&mut f, &mut ops, FIRST_TRACE, minus_one);
    let no = op(&mut f, &mut ops, OpKind::ConstBool(false), HirType::Bool);
    set(&mut f, &mut ops, CAUGHT, no);
    let middle = printer_object(&mut f, &mut ops, 2, "B", payload);
    let input = if shape == "direct" {
        middle
    } else {
        let first = printer_object(&mut f, &mut ops, 1, "A", payload);
        let last = printer_object(&mut f, &mut ops, 3, "C", payload);
        let inner = array_of(&mut f, &mut ops, &[first, middle, last], shape == "cycle");
        if shape == "nested" {
            let prefix = printer_object(&mut f, &mut ops, 4, "P", payload);
            let suffix = printer_object(&mut f, &mut ops, 5, "Q", payload);
            array_of(&mut f, &mut ops, &[prefix, inner, suffix], false)
        } else {
            inner
        }
    };
    let first_result = call(
        &mut f,
        &mut ops,
        "nts_value_to_string",
        vec![input],
        string(),
    );
    let raising = call(&mut f, &mut ops, "nts_raising", vec![], HirType::Bool);
    f.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond: raising,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    ));
    let mut ops = vec![];
    let taken = call(&mut f, &mut ops, "nts_raise_take", vec![], HirType::Erased);
    set(&mut f, &mut ops, CAUGHT_PAYLOAD, taken);
    let same = if object_payload {
        binary(&mut f, &mut ops, BinOp::Eq, taken, payload, HirType::Bool)
    } else {
        // JS checks the returned primitive with Object.is, including NaN/-0.
        op(&mut f, &mut ops, OpKind::ConstBool(true), HirType::Bool)
    };
    set(&mut f, &mut ops, CAUGHT, same);
    let trace = op(&mut f, &mut ops, OpKind::GlobalGet(TRACE), I32);
    set(&mut f, &mut ops, FIRST_TRACE, trace);
    set(&mut f, &mut ops, TRACE, zero);
    // The same array and objects, after Take; no fresh allocation can hide a
    // stale join frame. The middle printer's first call disabled its throw.
    let retried = call(
        &mut f,
        &mut ops,
        "nts_value_to_string",
        vec![input],
        string(),
    );
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(retried))));
    f.blocks
        .push(block(&[], &[], Terminator::Return(Some(first_result))));
    f
}

fn fixture() -> Program {
    let mut funcs = vec![printer()];
    for shape in ["direct", "flat", "nested", "cycle"] {
        funcs.push(entry(shape, shape, false));
        funcs.push(entry(&format!("{shape}Object"), shape, true));
    }
    let mut get = function("caughtPayload", &[], HirType::Erased);
    let read = value(&mut get, OpKind::GlobalGet(CAUGHT_PAYLOAD), HirType::Erased);
    get.blocks
        .push(block(&[], &[read], Terminator::Return(Some(read))));
    funcs.push(get);
    let mut p = program(funcs);
    p.public_api.retain(|(name, _)| name != SELECTED);
    p.printed
        .insert("Printer".into(), Printed::By(SELECTED.into()));
    p.layouts.push(Layout {
        types: vec![ClassId(1)],
        name: "Printer".into(),
        base: None,
        methods: vec![],
        interfaces: vec![],
        fields: [
            ("marker", I32),
            ("text", string()),
            ("fails", HirType::Bool),
            ("payload", HirType::Erased),
        ]
        .into_iter()
        .map(|(name, ty)| Field {
            name: name.into(),
            ty,
            written: None,
            declared_by: None,
            readonly: false,
        })
        .collect(),
    });
    p.classes.push(ClassIdentity {
        symbol: 101,
        name: "Printer".into(),
        types: vec![ClassId(1)],
    });
    for (at, (name, ty)) in [
        ("trace", I32),
        ("firstTrace", I32),
        ("caught", HirType::Bool),
        ("failOnce", HirType::Bool),
        ("savedPayload", HirType::Erased),
    ]
    .into_iter()
    .enumerate()
    {
        p.globals.push(Global {
            name: name.into(),
            ty,
            written: None,
            constant: false,
            initial: 0.0,
            exported: at < FAIL_ONCE as usize,
            deferred: false,
            origin: origin(),
        });
        if at < FAIL_ONCE as usize {
            p.public_api.push((name.into(), name.into()));
        }
    }
    p
}

#[test]
fn a_raising_printer_stops_consumption_unwinds_nested_joins_and_keeps_its_payload() {
    let emitted = nts_codegen_wasm::emit(&fixture()).unwrap();
    assert!(emitted.declined.is_empty(), "{:?}", emitted.declined);
    let result = common::run(
        "printed-raises",
        &emitted,
        "tooling/wasm/check-printed-raises.ts",
        &[],
    );
    assert_eq!(result["calls"], 168);
    assert_eq!(result["objectPayloadCalls"], 8);
    assert_eq!(result["repeatedNestedCalls"], 80);
}

#[test]
fn every_array_text_exit_clears_the_popped_join_slot() {
    let emitted = nts_codegen_wasm::emit(&fixture()).unwrap();
    let names = common::function_names(&emitted.bytes);
    let imported = emitted
        .manifest
        .imports
        .iter()
        .chain(&emitted.manifest.builtins)
        .filter(|i| matches!(i.ty, nts_codegen_wasm::ImportType::Function { .. }))
        .count();
    let mut at = imported;
    let mut arrays = 0;
    for payload in wasmparser::Parser::new(0).parse_all(&emitted.bytes) {
        if let wasmparser::Payload::CodeSectionEntry(body) = payload.unwrap() {
            if names[at].starts_with("array.text<") {
                let mut reader = body.get_operators_reader().unwrap();
                let mut cleared = false;
                let mut pops = 0;
                while !reader.eof() {
                    match reader.read().unwrap() {
                        wasmparser::Operator::RefNull {
                            hty:
                                wasmparser::HeapType::Abstract {
                                    ty: wasmparser::AbstractHeapType::Eq,
                                    ..
                                },
                        } => cleared = true,
                        wasmparser::Operator::ArraySet { .. } if cleared => {
                            pops += 1;
                            cleared = false;
                        }
                        _ => cleared = false,
                    }
                }
                assert_eq!(pops, 2, "normal and raised pop in {}", names[at]);
                arrays += 1;
            }
            at += 1;
        }
    }
    assert!(arrays > 0);
}
