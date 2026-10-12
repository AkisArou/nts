//! A reference moving between HIR types: an upcast is free, a downcast is a
//! checked cast, and unrelated storage is refused by name.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, block, function, program, value};
use nts_core::hir::{
    BlockId, Callee, ClassId, ClassIdentity, Field, Func, HirType, Layout, ManagedType, OpKind,
    Program, Terminator, ValueId,
};

const BASE: u32 = 1;
const DERIVED: u32 = 2;
const OTHER: u32 = 3;

fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(id)))
}
fn field(name: &str) -> Field {
    Field {
        name: name.into(),
        ty: F64,
        written: None,
        declared_by: None,
        readonly: false,
    }
}
fn classes(p: &mut Program) {
    for (id, name, fields, base) in [
        (BASE, "Base", vec![field("value")], None),
        (
            DERIVED,
            "Derived",
            vec![field("value"), field("extra")],
            Some(BASE),
        ),
        (OTHER, "Other", vec![field("value")], None),
    ] {
        p.layouts.push(Layout {
            types: vec![ClassId(id)],
            name: name.into(),
            fields,
            methods: vec![],
            interfaces: vec![],
            base: base.map(ClassId),
        });
        p.classes.push(ClassIdentity {
            symbol: id + 100,
            name: name.into(),
            types: vec![ClassId(id)],
        });
    }
}
fn op(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
/// `widen(d: Derived): Base` returns its argument: an upcast at a return.
fn widen() -> Func {
    let mut f = function("widen", &[object(DERIVED)], object(BASE));
    f.exported = false;
    let mut ops = vec![];
    let d = op(&mut f, &mut ops, OpKind::Param(0), object(DERIVED));
    f.blocks.push(block(&[], &ops, Terminator::Return(Some(d))));
    f
}
/// Allocate a `class` with every field set to the parameter.
fn filled(f: &mut Func, ops: &mut Vec<ValueId>, class: u32, fields: u32) -> ValueId {
    let x = op(f, ops, OpKind::Param(0), F64);
    let o = op(f, ops, OpKind::ObjectNew { frame: false }, object(class));
    for at in 0..fields {
        op(
            f,
            ops,
            OpKind::FieldSet {
                object: o,
                field: at,
                value: x,
            },
            HirType::Void,
        );
    }
    o
}
fn call_widen(f: &mut Func, ops: &mut Vec<ValueId>, arg: ValueId, ty: HirType) -> ValueId {
    op(
        f,
        ops,
        OpKind::Call {
            callee: Callee::Direct("widen".into()),
            args: vec![arg],
            frame: None,
        },
        ty,
    )
}
/// The result of `widen` held as a `Derived`: a downcast at a call result,
/// the shape `ref(): this` gives a subclass caller.
fn via_result() -> Func {
    let mut f = function("viaResult", &[F64], F64);
    let mut ops = vec![];
    let d = filled(&mut f, &mut ops, DERIVED, 2);
    let w = call_widen(&mut f, &mut ops, d, object(DERIVED));
    let extra = op(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: w,
            field: 1,
        },
        F64,
    );
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(extra))));
    f
}
/// The result of `widen` held as a `Base`, then passed along an edge whose
/// parameter is a `Derived`: a downcast at a block edge.
fn via_edge() -> Func {
    let mut f = function("viaEdge", &[F64], F64);
    let mut ops = vec![];
    let d = filled(&mut f, &mut ops, DERIVED, 2);
    let w = call_widen(&mut f, &mut ops, d, object(BASE));
    f.blocks.push(block(
        &[],
        &ops,
        Terminator::Jump {
            target: BlockId(1),
            args: vec![w],
        },
    ));
    let q = value(&mut f, OpKind::BlockParam(0), object(DERIVED));
    let mut ops = vec![];
    let extra = op(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: q,
            field: 1,
        },
        F64,
    );
    f.blocks
        .push(block(&[q], &ops, Terminator::Return(Some(extra))));
    f
}
fn fixture(funcs: Vec<Func>) -> Program {
    let mut p = program(funcs);
    p.public_api.retain(|(name, _)| name != "widen");
    classes(&mut p);
    p
}
fn casts(bytes: &[u8]) -> usize {
    let mut count = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::CodeSectionEntry(body) = payload.unwrap() {
            let mut reader = body.get_operators_reader().unwrap();
            while !reader.eof() {
                if matches!(
                    reader.read().unwrap(),
                    wasmparser::Operator::RefCastNullable { .. }
                        | wasmparser::Operator::RefCastNonNull { .. }
                ) {
                    count += 1;
                }
            }
        }
    }
    count
}

#[test]
fn a_downcast_is_one_checked_cast_and_an_upcast_is_free() {
    let emitted =
        nts_codegen_wasm::emit(&fixture(vec![widen(), via_result(), via_edge()])).unwrap();
    // One cast at `viaResult`'s call result and one at `viaEdge`'s edge; the
    // upcast in `widen`'s return and `viaEdge`'s call result costs nothing.
    assert_eq!(casts(&emitted.bytes), 2);
    let report = common::run("transfer", &emitted, "tooling/wasm/check-transfer.mjs", &[]);
    assert_eq!(report["cases"], 4);
}

#[test]
fn unrelated_storage_is_refused_by_name() {
    let mut confused = function("confused", &[F64], F64);
    let mut ops = vec![];
    let o = filled(&mut confused, &mut ops, OTHER, 1);
    let w = call_widen(&mut confused, &mut ops, o, object(BASE));
    let read = op(
        &mut confused,
        &mut ops,
        OpKind::FieldGet {
            object: w,
            field: 0,
        },
        F64,
    );
    confused
        .blocks
        .push(block(&[], &ops, Terminator::Return(Some(read))));
    let error = nts_codegen_wasm::emit(&fixture(vec![widen(), confused]))
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with(
            "NTS5001: wasm declines `confused`: a `Other` where a `Derived` is wanted"
        ),
        "{error}"
    );
}
