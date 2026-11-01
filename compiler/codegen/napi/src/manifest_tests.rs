//! Actual wrapper production computes shared signature facts once.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

#[test]
fn exported_aliases_share_the_completed_wrapper_signature() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for count in [16, 64, 256] {
        let dir = scratch::ScratchDir::new(&root.join("target/manifest-cost"), "aliases");
        let parameters = (0..count)
            .map(|i| format!("p{i}: number"))
            .collect::<Vec<_>>()
            .join(", ");
        let aliases = (0..count)
            .map(|i| format!("shared as alias{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        std::fs::write(
            dir.join("library.ts"),
            format!("export function shared({parameters}): number {{ return p0; }}"),
        )
        .unwrap();
        std::fs::write(
            dir.join("aliases.ts"),
            format!("export {{ {aliases} }} from './library';"),
        )
        .unwrap();
        std::fs::write(
            dir.join("main.ts"),
            "export * from './aliases'; export * as tools from './aliases';",
        )
        .unwrap();
        std::fs::write(dir.join("tsconfig.json"), format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","aliases.ts","library.ts"]}}"#)).unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&dir.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                roots: hir::reachable::Roots::EntrySurface,
                ..hir::Options::default()
            },
        )
        .unwrap();
        super::manifest::take_work();
        let addon = super::emit(&prepared.program);
        assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
        let (parameters, aliases) = super::manifest::take_work();
        assert_eq!(aliases, 2 * count);
        assert!(
            parameters <= 3 * count,
            "{count} parameters/aliases caused {parameters} signature visits"
        );
        assert_eq!(addon.manifest.exports.len(), 2 * count + 1);
        assert_eq!(
            addon.source.matches("napi_create_function(env,").count(),
            2 * count
        );
        println!(
            "parameters={count}: signature_visits={parameters}, publication_lookups={aliases}"
        );
    }
}
