#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir::{self, Memory, OpKind};
use nts_frontend_ts::Frontend;

#[test]
fn host_gc_keeps_logical_layouts_without_native_placement_or_counting() {
    let config = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/objects/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors());
    let native = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    let managed = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: Memory::HostGc,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        native.framed > 0,
        "the fixture must exercise native allocation placement"
    );
    assert_eq!(managed.framed, 0);
    assert_eq!(managed.program.provider, Memory::HostGc);
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
    for example in ["async", "a-var-holding-a-closure", "an-async-generator"] {
        let config = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../tests/programs/{example}/tsconfig.json"));
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(!snapshot.has_errors());
        for provider in [Memory::NoGc, Memory::ReferenceCounting, Memory::HostGc] {
            let prepared = hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::default()
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
            if provider == Memory::HostGc {
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
