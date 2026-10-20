//! Internal erased primitives preserve values, absence tags and GC identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, U32, block, function, origin, program, value};
use nts_core::hir::{Absent, BinOp, Func, Global, HirType, ManagedType, OpKind, Terminator, tags};

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
    assert_eq!(
        emitted
            .manifest
            .builtins
            .iter()
            .map(|import| (import.module.as_str(), import.name.as_str()))
            .collect::<Vec<_>>(),
        [("wasm:js-string", "test")]
    );
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

/// `typeof x === "number"` of an erased number: its tag compared with the
/// number tag by `op`. With `stored`, the tag is also written to global 0, a
/// use that needs the whole tag.
fn number_tag_test(name: &str, op: BinOp, stored: bool) -> Func {
    let mut f = function(name, &[F64], HirType::Bool);
    let input = value(&mut f, OpKind::Param(0), F64);
    let erased = value(
        &mut f,
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let tag = value(&mut f, OpKind::TagOf { value: erased }, U32);
    let number = value(&mut f, OpKind::ConstInt(i128::from(tags::NUMBER)), U32);
    let test = value(
        &mut f,
        OpKind::Binary {
            op,
            lhs: tag,
            rhs: number,
        },
        HirType::Bool,
    );
    let mut ops = vec![input, erased, tag, number, test];
    if stored {
        ops.push(value(
            &mut f,
            OpKind::GlobalSet {
                global: 0,
                value: tag,
            },
            HirType::Void,
        ));
    }
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(test))));
    f
}

/// A tag asked only whether it is the number tag, `==` or `!=`, is the
/// unerase's own number test -- no `value.tag`, and so no `wasm:js-string`
/// `test` crossing to rule out a string first. A tag with another use is the
/// whole tag.
#[test]
fn a_tag_asked_only_whether_it_is_a_number_is_two_ref_tests() {
    let asked = nts_codegen_wasm::emit(&program(vec![
        number_tag_test("isNumber", BinOp::Eq, false),
        number_tag_test("notNumber", BinOp::Ne, false),
    ]))
    .unwrap();
    let names = common::function_names(&asked.bytes);
    assert!(!names.iter().any(|name| name == "value.tag"), "{names:?}");
    assert!(
        !asked.manifest.builtins.iter().any(|i| i.name == "test"),
        "{:?}",
        asked.manifest.builtins
    );
    // The control: the same comparison of a tag that is also stored keeps the
    // whole tag, so its absence above is the asking's and not a tag that is
    // never made.
    let mut both = program(vec![
        number_tag_test("isNumber", BinOp::Eq, false),
        number_tag_test("storedTag", BinOp::Eq, true),
    ]);
    both.globals.push(Global {
        name: "lastTag".into(),
        ty: U32,
        written: None,
        constant: false,
        initial: 0.0,
        exported: false,
        deferred: false,
        origin: origin(),
    });
    let emitted = nts_codegen_wasm::emit(&both).unwrap();
    let calls = common::calls_by_name(&emitted.bytes);
    assert!(
        !calls["isNumber"].iter().any(|callee| callee == "value.tag"),
        "{calls:?}"
    );
    assert!(
        calls["storedTag"]
            .iter()
            .any(|callee| callee == "value.tag"),
        "{calls:?}"
    );
}
