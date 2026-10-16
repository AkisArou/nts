//! Internal erased primitives preserve values, absence tags and GC identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, U32, block, function, origin, program, value};
use nts_core::hir::{Absent, Func, Global, HirType, ManagedType, OpKind, Terminator};

fn roundtrip(name: &str, ty: HirType, tag: bool) -> Func {
    let mut f = function(
        name,
        std::slice::from_ref(&ty),
        if tag { U32 } else { ty.clone() },
    );
    let input = value(&mut f, OpKind::Param(0), ty.clone());
    let boxed = value(
        &mut f,
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let result = if tag {
        value(&mut f, OpKind::TagOf { value: boxed }, U32)
    } else {
        value(&mut f, OpKind::Unerase { value: boxed }, ty)
    };
    f.blocks.push(block(
        &[],
        &[input, boxed, result],
        Terminator::Return(Some(result)),
    ));
    f
}

fn absence(name: &str, kind: OpKind, absent: Option<Absent>) -> Func {
    let mut f = function(name, &[], U32);
    let mut input = value(
        &mut f,
        kind,
        if absent.is_some() {
            HirType::Managed(ManagedType::String)
        } else {
            HirType::Erased
        },
    );
    let mut ops = vec![input];
    if let Some(absent) = absent {
        input = value(
            &mut f,
            OpKind::Erase {
                value: input,
                absent,
                slots: nts_core::hir::Absent::Impossible,
            },
            HirType::Erased,
        );
        ops.push(input);
    }
    let tag = value(&mut f, OpKind::TagOf { value: input }, U32);
    ops.push(tag);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(tag))));
    f
}

fn nullable_unerasure(name: &str, kind: OpKind, absent: Absent) -> Func {
    let mut f = function(name, &[], U32);
    let input = value(&mut f, kind, HirType::Erased);
    let reference = value(
        &mut f,
        OpKind::Unerase { value: input },
        HirType::Managed(ManagedType::String),
    );
    let erased = value(
        &mut f,
        OpKind::Erase {
            value: reference,
            absent,
            slots: nts_core::hir::Absent::Impossible,
        },
        HirType::Erased,
    );
    let tag = value(&mut f, OpKind::TagOf { value: erased }, U32);
    f.blocks.push(block(
        &[],
        &[input, reference, erased, tag],
        Terminator::Return(Some(tag)),
    ));
    f
}

#[test]
fn erased_primitives_and_defined_immutable_singletons_execute_exactly() {
    let string = HirType::Managed(ManagedType::String);
    let mut funcs = Vec::new();
    for (name, ty) in [
        ("number", F64),
        ("boolean", HirType::Bool),
        ("string", string),
    ] {
        funcs.push(roundtrip(name, ty.clone(), false));
        funcs.push(roundtrip(&format!("{name}Tag"), ty, true));
    }
    funcs.push(absence("nullTag", OpKind::ConstNull, None));
    funcs.push(absence("undefinedTag", OpKind::ConstUndefined, None));
    funcs.push(absence(
        "nullableNullTag",
        OpKind::ConstNull,
        Some(Absent::Null),
    ));
    funcs.push(absence(
        "nullableUndefinedTag",
        OpKind::ConstUndefined,
        Some(Absent::Undefined),
    ));
    funcs.push(nullable_unerasure(
        "unboxedNullTag",
        OpKind::ConstNull,
        Absent::Null,
    ));
    funcs.push(nullable_unerasure(
        "unboxedUndefinedTag",
        OpKind::ConstUndefined,
        Absent::Undefined,
    ));
    let mut global = function("defaultGlobalTag", &[], U32);
    let read = value(&mut global, OpKind::GlobalGet(0), HirType::Erased);
    let tag = value(&mut global, OpKind::TagOf { value: read }, U32);
    global
        .blocks
        .push(block(&[], &[read, tag], Terminator::Return(Some(tag))));
    funcs.push(global);
    let mut p = program(funcs);
    p.globals.push(Global {
        name: "internal".into(),
        ty: HirType::Erased,
        written: None,
        constant: false,
        initial: 0.0,
        exported: false,
        deferred: false,
        origin: origin(),
    });
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.features, ["gc"]);
    assert_eq!(emitted.manifest.builtins, ["js-string"]);
    assert!(
        emitted
            .manifest
            .imports
            .iter()
            .any(|import| import.name == "inputDecline")
    );
    let report = common::run("erased", &emitted, "tooling/wasm/check-erased.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 100);
}

/// A tag is read of an erased value only. A typed string's null does not say
/// whether it stands for `null` or `undefined`, so its tag is refused by name,
/// never left to an engine error.
#[test]
fn the_tag_of_a_typed_value_is_refused_by_name() {
    let string = HirType::Managed(ManagedType::String);
    let mut f = function("typedTag", &[], U32);
    let null = value(&mut f, OpKind::ConstNull, string);
    let tag = value(&mut f, OpKind::TagOf { value: null }, U32);
    f.blocks
        .push(block(&[], &[null, tag], Terminator::Return(Some(tag))));
    let nts_codegen_wasm::EmitError::Declined(ds) =
        nts_codegen_wasm::emit(&program(vec![f])).unwrap_err()
    else {
        panic!("expected a named decline")
    };
    assert!(
        ds.iter().any(|d| d.code == "NTS5001"
            && d.message.contains("typedTag")
            && d.message
                .contains("the tag of a typed Managed(String) value")),
        "{ds:?}"
    );
}
