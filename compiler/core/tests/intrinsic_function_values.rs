//! An intrinsic's function-value wrapper calls the backend helper, including
//! its declared symbol alias, rather than an absent TypeScript body.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;

fn prepared(provided: hir::features::Provided) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/an-intrinsic-helper-passed-as-a-function/tsconfig.json")
        .canonicalize_utf8()
        .expect("fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    hir::prepare_with(
        &snapshot,
        &hir::Options {
            provided,
            ..hir::Options::default()
        },
    )
    .expect("valid prepared HIR")
}

#[test]
fn an_intrinsic_value_keeps_its_external_symbol() {
    let prepared = prepared(hir::features::Provided::By(|name| name == "nts_is_finite"));
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    assert!(prepared.program.refused_bodies().next().is_none());
    assert!(prepared.program.funcs.iter().any(|function| {
        function
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .any(|value| {
                let op = &function.values[value.0 as usize];
                matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                if name == "nts_is_finite")
            })
    }));
    assert!(!prepared.program.funcs.iter().any(|function| {
        function
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .any(|value| {
                let op = &function.values[value.0 as usize];
                matches!(&op.kind, OpKind::Call { callee: Callee::Direct(name), .. }
                if name == "finite")
            })
    }));
}

#[test]
fn an_unprovided_intrinsic_keeps_the_fallback() {
    let prepared = prepared(hir::features::Provided::Nothing);
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    assert!(prepared.program.refused_bodies().next().is_none());
    // Branch pruning leaves old definitions in the SSA arena. Only block
    // operations are emitted, so dead definitions must not decide this guard.
    let calls: Vec<_> = prepared
        .program
        .funcs
        .iter()
        .flat_map(|function| {
            function
                .blocks
                .iter()
                .flat_map(|block| &block.ops)
                .filter_map(move |value| {
                    let op = &function.values[value.0 as usize];
                    matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                if name == "nts_is_finite")
                    .then(|| (function.name.clone(), value.0, op.origin.clone()))
                })
        })
        .collect();
    assert!(calls.is_empty(), "unprovided helper calls: {calls:?}");
}
