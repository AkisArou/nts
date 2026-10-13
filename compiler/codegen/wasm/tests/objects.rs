//! Semantic class identity, recursive fields and erased references stay intact.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, U32, block, function, origin, program, value};
use nts_core::hir::ClassId;
use nts_core::hir::{
    Absent, BinOp, BlockId, ClassIdentity, Field, Func, Global, HirType, Layout, ManagedType,
    OpKind, Program, Terminator, UnOp, ValueId,
};

fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(id)))
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
fn layout(ids: &[u32], name: &str, fields: Vec<Field>, base: Option<u32>) -> Layout {
    Layout {
        types: ids.iter().copied().map(ClassId).collect(),
        name: name.into(),
        fields,
        methods: vec![],
        interfaces: vec![],
        base: base.map(ClassId),
    }
}
fn layouts(p: &mut Program) {
    let fields = vec![
        field("value", F64),
        field("erased", HirType::Erased),
        field("next", object(1)),
    ];
    p.layouts
        .push(layout(&[1, 2], "SharedAB", fields.clone(), None));
    let mut derived = fields;
    derived.push(field("extra", HirType::Managed(ManagedType::String)));
    p.layouts.push(layout(&[3], "Child", derived, Some(1)));
    p.layouts.push(layout(
        &[10],
        "EqualStorageA",
        vec![field("value", F64)],
        None,
    ));
    p.layouts.push(layout(
        &[11],
        "EqualStorageB",
        vec![field("value", F64)],
        None,
    ));
    p.layouts.push(layout(
        &[20],
        "Packed",
        vec![
            field(
                "signed",
                HirType::Int {
                    bits: 8,
                    signed: true,
                },
            ),
            field(
                "unsigned",
                HirType::Int {
                    bits: 16,
                    signed: false,
                },
            ),
        ],
        None,
    ));
    // One Wasm shape, two field orders: only the type's identity tells them
    // apart.
    p.layouts.push(layout(
        &[12],
        "OrderXY",
        vec![field("x", F64), field("y", F64)],
        None,
    ));
    p.layouts.push(layout(
        &[13],
        "OrderYX",
        vec![field("y", F64), field("x", F64)],
        None,
    ));
    for (id, name) in [
        (1, "A"),
        (2, "B"),
        (3, "Child"),
        (10, "EqualStorageA"),
        (11, "EqualStorageB"),
        (12, "OrderXY"),
        (13, "OrderYX"),
    ] {
        p.classes.push(ClassIdentity {
            symbol: id + 100,
            name: name.into(),
            types: vec![ClassId(id)],
        });
    }
}
fn emit_value(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
fn allocate(f: &mut Func, ops: &mut Vec<ValueId>, id: u32) -> ValueId {
    emit_value(f, ops, OpKind::ObjectNew { frame: false }, object(id))
}
fn erase(f: &mut Func, ops: &mut Vec<ValueId>, input: ValueId) -> ValueId {
    emit_value(
        f,
        ops,
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
        },
        HirType::Erased,
    )
}
fn set(f: &mut Func, ops: &mut Vec<ValueId>, receiver: ValueId, at: u32, stored: ValueId) {
    emit_value(
        f,
        ops,
        OpKind::FieldSet {
            object: receiver,
            field: at,
            value: stored,
        },
        HirType::Void,
    );
}
fn finish(mut f: Func, ops: Vec<ValueId>, result: ValueId) -> Func {
    f.blocks.push(nts_core::hir::Block {
        params: vec![],
        ops,
        terminator: Terminator::Return(Some(result)),
    });
    f
}
fn nominal(name: &str, allocated: u32, tested: u32, erased: bool) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = Vec::new();
    let mut input = allocate(&mut f, &mut ops, allocated);
    if erased {
        input = erase(&mut f, &mut ops, input);
    }
    let test = emit_value(
        &mut f,
        &mut ops,
        OpKind::InstanceOf {
            value: input,
            classes: vec![ClassId(tested)],
        },
        HirType::Bool,
    );
    finish(f, ops, test)
}
fn field_roundtrip(name: &str, class: u32, at: u32, ty: HirType) -> Func {
    let mut f = function(name, std::slice::from_ref(&ty), ty.clone());
    let mut ops = Vec::new();
    let input = emit_value(&mut f, &mut ops, OpKind::Param(0), ty.clone());
    let receiver = allocate(&mut f, &mut ops, class);
    set(&mut f, &mut ops, receiver, at, input);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: receiver,
            field: at,
        },
        ty,
    );
    finish(f, ops, read)
}
fn projection() -> Func {
    let mut f = function("projection", &[], HirType::Bool);
    let mut ops = Vec::new();
    let input = allocate(&mut f, &mut ops, 3);
    let erased = erase(&mut f, &mut ops, input);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unerase { value: erased },
        object(1),
    );
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: input,
            rhs: read,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn identity(name: &str, erased: bool, same: bool) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = Vec::new();
    let first = allocate(&mut f, &mut ops, 1);
    let second = if same {
        first
    } else {
        allocate(&mut f, &mut ops, 2)
    };
    let (a, b) = if erased {
        (
            erase(&mut f, &mut ops, first),
            erase(&mut f, &mut ops, second),
        )
    } else {
        (first, second)
    };
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: a,
            rhs: b,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn defaults(name: &str, at: u32, ty: HirType, tag: bool) -> Func {
    let mut f = function(name, &[], if tag { U32 } else { ty.clone() });
    let mut ops = Vec::new();
    let input = allocate(&mut f, &mut ops, 1);
    let mut read = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: input,
            field: at,
        },
        ty,
    );
    if tag {
        read = emit_value(&mut f, &mut ops, OpKind::TagOf { value: read }, U32);
    }
    finish(f, ops, read)
}
fn next() -> Func {
    let mut f = function("next", &[F64], F64);
    let mut ops = Vec::new();
    let number = emit_value(&mut f, &mut ops, OpKind::Param(0), F64);
    let head = allocate(&mut f, &mut ops, 1);
    let tail = allocate(&mut f, &mut ops, 2);
    set(&mut f, &mut ops, head, 2, tail);
    set(&mut f, &mut ops, tail, 0, number);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: head,
            field: 2,
        },
        object(1),
    );
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: read,
            field: 0,
        },
        F64,
    );
    finish(f, ops, result)
}
fn erased_field() -> Func {
    let mut f = function("erasedField", &[F64], F64);
    let mut ops = Vec::new();
    let input = emit_value(&mut f, &mut ops, OpKind::Param(0), F64);
    let erased = erase(&mut f, &mut ops, input);
    let object = allocate(&mut f, &mut ops, 1);
    set(&mut f, &mut ops, object, 1, erased);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet { object, field: 1 },
        HirType::Erased,
    );
    let result = emit_value(&mut f, &mut ops, OpKind::Unerase { value: read }, F64);
    finish(f, ops, result)
}
fn swap() -> Func {
    let mut f = function("swap", &[I32, F64, F64], F64);
    let mut entry = Vec::new();
    let count = emit_value(&mut f, &mut entry, OpKind::Param(0), I32);
    let left_number = emit_value(&mut f, &mut entry, OpKind::Param(1), F64);
    let right_number = emit_value(&mut f, &mut entry, OpKind::Param(2), F64);
    let first = allocate(&mut f, &mut entry, 1);
    let second = allocate(&mut f, &mut entry, 2);
    set(&mut f, &mut entry, first, 0, left_number);
    set(&mut f, &mut entry, second, 0, right_number);
    let left_phi = value(&mut f, OpKind::BlockParam(0), object(1));
    let right_phi = value(&mut f, OpKind::BlockParam(1), object(1));
    let counter = value(&mut f, OpKind::BlockParam(2), I32);
    let mut test = Vec::new();
    let zero = emit_value(&mut f, &mut test, OpKind::ConstInt(0), I32);
    let cond = emit_value(
        &mut f,
        &mut test,
        OpKind::Binary {
            op: BinOp::Gt,
            lhs: counter,
            rhs: zero,
        },
        HirType::Bool,
    );
    let mut decrement = Vec::new();
    let one = emit_value(&mut f, &mut decrement, OpKind::ConstInt(1), I32);
    let remaining = emit_value(
        &mut f,
        &mut decrement,
        OpKind::Binary {
            op: BinOp::Sub,
            lhs: counter,
            rhs: one,
        },
        I32,
    );
    let read = value(
        &mut f,
        OpKind::FieldGet {
            object: left_phi,
            field: 0,
        },
        F64,
    );
    f.blocks = vec![
        block(
            &[],
            &entry,
            Terminator::Jump {
                target: BlockId(1),
                args: vec![first, second, count],
            },
        ),
        block(
            &[left_phi, right_phi, counter],
            &test,
            Terminator::Branch {
                cond,
                then_target: BlockId(2),
                then_args: vec![],
                else_target: BlockId(3),
                else_args: vec![],
            },
        ),
        block(
            &[],
            &decrement,
            Terminator::Jump {
                target: BlockId(1),
                args: vec![right_phi, left_phi, remaining],
            },
        ),
        block(&[], &[read], Terminator::Return(Some(read))),
    ];
    f
}
fn erased_inspection(name: &str, tag: bool) -> Func {
    let mut f = function(name, &[], if tag { U32 } else { HirType::Bool });
    let mut ops = Vec::new();
    let allocated = allocate(&mut f, &mut ops, 1);
    let input = erase(&mut f, &mut ops, allocated);
    let kind = if tag {
        OpKind::TagOf { value: input }
    } else {
        OpKind::Unary {
            op: UnOp::Truthy,
            operand: input,
        }
    };
    let ty = f.return_type.clone();
    let result = emit_value(&mut f, &mut ops, kind, ty);
    finish(f, ops, result)
}
fn null_field() -> Func {
    let mut f = function("nullField", &[], F64);
    let mut ops = Vec::new();
    let input = emit_value(&mut f, &mut ops, OpKind::ConstNull, object(1));
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: input,
            field: 0,
        },
        F64,
    );
    finish(f, ops, result)
}

fn alias_identity(name: &str, allocated: u32, projected: u32, tested: u32) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = Vec::new();
    let input = allocate(&mut f, &mut ops, allocated);
    let erased = erase(&mut f, &mut ops, input);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unerase { value: erased },
        object(projected),
    );
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::InstanceOf {
            value: read,
            classes: vec![ClassId(tested)],
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
/// An `OrderYX` holding y = 10 and x = 20, projected as an `OrderXY` and read
/// at `x`. Its storage is the same Wasm shape, so only a nominal test refuses
/// it; a structural one passes it and answers its `y`, 10.
fn reordered_alias() -> Func {
    let mut f = function("reorderedAlias", &[], F64);
    let mut ops = Vec::new();
    let input = allocate(&mut f, &mut ops, 13);
    let ten = emit_value(&mut f, &mut ops, OpKind::ConstFloat(10.0), F64);
    let twenty = emit_value(&mut f, &mut ops, OpKind::ConstFloat(20.0), F64);
    set(&mut f, &mut ops, input, 0, ten);
    set(&mut f, &mut ops, input, 1, twenty);
    let erased = erase(&mut f, &mut ops, input);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unerase { value: erased },
        object(12),
    );
    let x = emit_value(
        &mut f,
        &mut ops,
        OpKind::FieldGet {
            object: read,
            field: 0,
        },
        F64,
    );
    finish(f, ops, x)
}
fn absent_projection(name: &str, undefined: bool) -> Func {
    let mut f = function(name, &[], U32);
    let mut ops = Vec::new();
    let input = emit_value(
        &mut f,
        &mut ops,
        if undefined {
            OpKind::ConstUndefined
        } else {
            OpKind::ConstNull
        },
        HirType::Erased,
    );
    let pointer = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unerase { value: input },
        object(1),
    );
    let erased = emit_value(
        &mut f,
        &mut ops,
        OpKind::Erase {
            value: pointer,
            absent: if undefined {
                Absent::Undefined
            } else {
                Absent::Null
            },
        },
        HirType::Erased,
    );
    let result = emit_value(&mut f, &mut ops, OpKind::TagOf { value: erased }, U32);
    finish(f, ops, result)
}
fn primitive_instance(name: &str, ty: Option<HirType>, undefined: bool) -> Func {
    let params = ty.clone().into_iter().collect::<Vec<_>>();
    let mut f = function(name, &params, HirType::Bool);
    let mut ops = Vec::new();
    let input = if let Some(ty) = ty {
        let input = emit_value(&mut f, &mut ops, OpKind::Param(0), ty);
        erase(&mut f, &mut ops, input)
    } else {
        emit_value(
            &mut f,
            &mut ops,
            if undefined {
                OpKind::ConstUndefined
            } else {
                OpKind::ConstNull
            },
            HirType::Erased,
        )
    };
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::InstanceOf {
            value: input,
            classes: vec![ClassId(1)],
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn bad_projection() -> Func {
    let mut f = function("badProjection", &[F64], HirType::Bool);
    let mut ops = Vec::new();
    let input = emit_value(&mut f, &mut ops, OpKind::Param(0), F64);
    let erased = erase(&mut f, &mut ops, input);
    let read = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unerase { value: erased },
        object(1),
    );
    let result = emit_value(
        &mut f,
        &mut ops,
        OpKind::Unary {
            op: UnOp::Truthy,
            operand: read,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
/// Which class an object is, and which projections keep it: every class
/// tested against every class, and aliases of merged and equal storage.
fn class_identities() -> Vec<Func> {
    let mut funcs = vec![
        alias_identity("mergedAlias", 2, 1, 1),
        alias_identity("canonicalAlias", 11, 10, 10),
        reordered_alias(),
    ];
    for created in [1, 2, 3, 10, 11] {
        for tested in [1, 2, 3, 10, 11] {
            for erased in [false, true] {
                funcs.push(nominal(
                    &format!("is_{created}_{tested}_{}", u8::from(erased)),
                    created,
                    tested,
                    erased,
                ));
            }
        }
    }
    funcs
}
#[test]
fn class_identity_inheritance_fields_and_erasure_execute_exactly() {
    let mut funcs = vec![
        projection(),
        next(),
        erased_field(),
        swap(),
        erased_inspection("objectTag", true),
        erased_inspection("objectTruthy", false),
        null_field(),
        defaults("defaultNumber", 0, F64, false),
        defaults("defaultErased", 1, HirType::Erased, true),
        absent_projection("nullProjection", false),
        absent_projection("undefinedProjection", true),
        primitive_instance("numberIsA", Some(F64), false),
        primitive_instance("booleanIsA", Some(HirType::Bool), false),
        primitive_instance(
            "stringIsA",
            Some(HirType::Managed(ManagedType::String)),
            false,
        ),
        primitive_instance("nullIsA", None, false),
        primitive_instance("undefinedIsA", None, true),
        bad_projection(),
    ];
    funcs.extend(class_identities());
    for erased in [false, true] {
        for same in [false, true] {
            funcs.push(identity(
                &format!("eq_{}_{}", u8::from(erased), u8::from(same)),
                erased,
                same,
            ));
        }
    }
    funcs.push(field_roundtrip("numberField", 3, 0, F64));
    funcs.push(field_roundtrip(
        "stringField",
        3,
        3,
        HirType::Managed(ManagedType::String),
    ));
    funcs.push(field_roundtrip(
        "signed8",
        20,
        0,
        HirType::Int {
            bits: 8,
            signed: true,
        },
    ));
    funcs.push(field_roundtrip(
        "unsigned16",
        20,
        1,
        HirType::Int {
            bits: 16,
            signed: false,
        },
    ));
    let mut global = function("global", &[], F64);
    let read = value(&mut global, OpKind::GlobalGet(0), F64);
    global
        .blocks
        .push(block(&[], &[read], Terminator::Return(Some(read))));
    funcs.push(global);
    let mut p = program(funcs);
    layouts(&mut p);
    p.globals.push(Global {
        name: "internal".into(),
        ty: F64,
        written: None,
        constant: true,
        initial: 17.0,
        exported: false,
        deferred: false,
        origin: origin(),
    });
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.features, ["gc"]);
    assert!(
        emitted
            .manifest
            .functions
            .iter()
            .all(|f| f.route == nts_codegen_wasm::Route::Structured)
    );
    let report = common::run("objects", &emitted, "tooling/wasm/check-objects.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 500);
}

/// One class identity on two layouts at different depths: a root layout and
/// one under an unrelated base. Its class test cannot read one display slot,
/// so it scans; every other class still reads one.
#[test]
fn a_class_at_two_depths_is_tested_by_scanning() {
    const BASE: u32 = 30;
    const AT_ROOT: u32 = 31;
    const UNDER_BASE: u32 = 32;
    let funcs = vec![
        nominal("rootIsSplit", AT_ROOT, AT_ROOT, false),
        nominal("underIsSplit", UNDER_BASE, AT_ROOT, true),
        nominal("baseIsSplit", BASE, AT_ROOT, false),
        nominal("underIsBase", UNDER_BASE, BASE, false),
        nominal("rootIsBase", AT_ROOT, BASE, true),
    ];
    let mut p = program(funcs);
    p.layouts
        .push(layout(&[BASE], "Base", vec![field("value", F64)], None));
    p.layouts
        .push(layout(&[AT_ROOT], "SplitRoot", vec![], None));
    p.layouts.push(layout(
        &[UNDER_BASE],
        "SplitUnder",
        vec![field("value", F64)],
        Some(BASE),
    ));
    p.classes.push(ClassIdentity {
        symbol: 130,
        name: "Base".into(),
        types: vec![ClassId(BASE)],
    });
    p.classes.push(ClassIdentity {
        symbol: 131,
        name: "Split".into(),
        types: vec![ClassId(AT_ROOT), ClassId(UNDER_BASE)],
    });
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    let report = common::run(
        "class-at-two-depths",
        &emitted,
        "tooling/wasm/check-class-depths.mjs",
        &[],
    );
    assert_eq!(report["cases"], 5);
}
