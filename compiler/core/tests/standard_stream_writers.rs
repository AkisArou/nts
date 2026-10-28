//! Both subjects compile and call the selected writers; the console controls
//! cannot make this guard pass when only they survive lowering.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;

#[test]
fn standard_stream_subjects_survive_with_and_without_the_helpers() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/standard-stream-writes-share-console-order/tsconfig.json")
        .canonicalize_utf8()
        .expect("fixture config");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture");
    assert!(!snapshot.has_errors());
    for available in [false, true] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provided: if available {
                    hir::features::Provided::By(|name| {
                        matches!(name, "nts_write_stdout" | "nts_write_stderr")
                    })
                } else {
                    hir::features::Provided::Nothing
                },
                ..hir::Options::default()
            },
        )
        .expect("valid program");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        assert!(prepared.program.refused_bodies().next().is_none());
        for name in [
            "stdoutOrder",
            "stdoutControl",
            "stderrOrder",
            "stderrControl",
        ] {
            assert!(
                prepared
                    .program
                    .funcs
                    .iter()
                    .any(|function| function.name == name),
                "missing {name}"
            );
        }
        for helper in ["nts_write_stdout", "nts_write_stderr"] {
            let called = prepared.program.funcs.iter().any(|function| {
                function
                    .blocks
                    .iter()
                    .flat_map(|block| &block.ops)
                    .any(|value| {
                        matches!(&function.values[value.0 as usize].kind,
                        OpKind::Call { callee: Callee::External(name), .. } if name == helper)
                    })
            });
            assert_eq!(called, available, "{helper}");
        }
    }
}
