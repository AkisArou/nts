//! Host-managed memory keeps semantic preparation and skips native placement.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir::{self, OpKind, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn host_gc_keeps_logical_layouts_without_native_placement_or_counting() {
    let tsgo = std::env::var("NTS_TSGO").expect("NTS_TSGO required for provider acceptance");
    let config = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/objects/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    assert!(!snapshot.has_errors());
    let native = hir::prepare_with(
        &snapshot,
        &hir::Options::new(hir::InterfaceAccess::Materialize),
    )
    .unwrap();
    let managed = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: Provider::HostGc,
            ..hir::Options::new(hir::InterfaceAccess::Materialize)
        },
    )
    .unwrap();
    assert!(
        native.framed > 0,
        "the fixture must exercise native allocation placement"
    );
    assert_eq!(managed.framed, 0);
    assert_eq!(managed.program.provider, Provider::HostGc);
    assert_eq!(
        format!("{:?}", native.program.layouts),
        format!("{:?}", managed.program.layouts)
    );
    assert_eq!(native.program.public_api, managed.program.public_api);
    for func in &managed.program.funcs {
        for id in func.blocks.iter().flat_map(|block| &block.ops) {
            let op = func.value(*id);
            assert!(
                !matches!(
                    op.kind,
                    OpKind::ObjectNew { frame: true }
                        | OpKind::Call { frame: Some(_), .. }
                        | OpKind::Retain(_)
                        | OpKind::Release(_)
                ),
                "{}: {:?}",
                func.name,
                op.kind
            );
        }
    }
}

#[test]
fn async_frames_only_have_lifetime_markers_for_native_providers() {
    let tsgo = std::env::var("NTS_TSGO").expect("NTS_TSGO required for provider acceptance");
    for example in ["async", "a-var-holding-a-closure", "an-async-generator"] {
        let config = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../tests/programs/{example}/tsconfig.json"));
        let snapshot = TsgoApi::for_compilation(&tsgo).snapshot(&config).unwrap();
        assert!(!snapshot.has_errors());
        for provider in [
            Provider::NoGc,
            Provider::ReferenceCounting,
            Provider::HostGc,
        ] {
            let prepared = hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::new(hir::InterfaceAccess::Materialize)
                },
            )
            .unwrap();
            let markers = prepared
                .program
                .funcs
                .iter()
                .flat_map(|func| {
                    func.blocks
                        .iter()
                        .flat_map(|block| &block.ops)
                        .map(|id| func.value(*id))
                })
                .filter(|op| matches!(op.kind, OpKind::Retain(_) | OpKind::Release(_)))
                .count();
            assert!(!prepared.program.funcs.is_empty());
            if provider == Provider::HostGc {
                assert_eq!(markers, 0, "{example}");
            } else {
                assert!(
                    markers > 0,
                    "{example}: {provider:?} must keep the native frame ABI"
                );
            }
        }
    }
}
