//! A backend refusal forced after the real HIR entry materialization.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, Op, OpKind, ValueId};
use nts_frontend_ts::Frontend;

pub(super) fn refused_body(backend: hir::backend::Backend) -> hir::Program {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/programs/a-direct-call-hands-an-argument-to-a-published-method/tsconfig.json")
        .canonicalize_utf8().unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors());
    let mut program = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::new(backend)
        },
    )
    .unwrap()
    .program;
    let body = program
        .funcs
        .iter_mut()
        .find(|func| func.name == "@consuming:publish")
        .unwrap();
    let parameter = body.parameter_values().unwrap()[0].unwrap();
    let yielded = ValueId(u32::try_from(body.values.len()).unwrap());
    // A yield must have been transformed before backend emission. Insert one
    // here to force the real backend's refusal inside the materialized body.
    body.values.push(Op {
        kind: OpKind::Yield { value: parameter },
        ty: HirType::Void,
        origin: body.origin.clone(),
    });
    body.blocks[0].ops.push(yielded);
    program
}

pub(super) fn assert_source_name(diagnostics: &[nts_diagnostics::Diagnostic]) {
    assert!(!diagnostics.is_empty(), "the forced refusal must fire");
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("`publish`")),
        "{diagnostics:?}"
    );
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| !diagnostic.message.contains("@consuming:")),
        "{diagnostics:?}"
    );
}
