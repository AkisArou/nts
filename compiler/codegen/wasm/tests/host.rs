//! The host ABI preserves primitive strings and checks typed import contracts.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, block, function, program, value};
use nts_core::hir::{BinOp, HirType, Layout, ManagedType, OpKind, Terminator};
use nts_semantic_schema::TypeId;

#[test]
fn typed_host_imports_strings_gc_probes_and_capability_failures() {
    let string = HirType::Managed(ManagedType::String);
    let mut identity = function("identity", std::slice::from_ref(&string), string.clone());
    let arg = value(&mut identity, OpKind::Param(0), string);
    identity
        .blocks
        .push(block(&[], &[arg], Terminator::Return(Some(arg))));
    let mut remainder = function("remainder", &[F64, F64], F64);
    let lhs = value(&mut remainder, OpKind::Param(0), F64);
    let rhs = value(&mut remainder, OpKind::Param(1), F64);
    let result = value(
        &mut remainder,
        OpKind::Binary {
            op: BinOp::Rem,
            lhs,
            rhs,
        },
        F64,
    );
    remainder.blocks.push(block(
        &[],
        &[lhs, rhs, result],
        Terminator::Return(Some(result)),
    ));
    let mut private = function(
        "privateGc",
        &[HirType::Managed(ManagedType::Object(TypeId(1)))],
        HirType::Void,
    );
    private
        .blocks
        .push(block(&[], &[], Terminator::Return(None)));
    let mut p = program(vec![identity, remainder, private]);
    p.public_api.retain(|(name, _)| name != "privateGc");
    p.layouts.push(Layout {
        types: vec![TypeId(1)],
        name: "Node".into(),
        fields: vec![],
        methods: vec![],
        interfaces: vec![],
        base: None,
    });
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.abi, 3);
    assert_eq!(emitted.manifest.features, ["gc"]);
    let report = common::run("host", &emitted, "tooling/wasm/check-host.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() >= 23);
}
