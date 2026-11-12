//! A constructor keeps its callable/constructible identity through a host capability view.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir::{self, Memory};
use nts_frontend_ts::Frontend;

use crate::common;

struct Scratch(crate::scratch::StdScratchDir);

#[test]
fn the_real_stream_constructor_prepares_with_both_ambient_contracts() {
    let root = common::repository();
    let scratch = Scratch(crate::scratch::StdScratchDir::path_in_std_target(
        "constructor-capabilities",
    ));
    for (ambient, types) in [("bare", vec![]), ("node", vec!["node"])] {
        let directory = scratch.0.join(ambient);
        std::fs::create_dir_all(&directory).unwrap();
        let config = directory.join("tsconfig.json");
        std::fs::write(
            &config,
            serde_json::json!({
                "extends": root.join("runtime/node/stream/tsconfig.json"),
                "compilerOptions": {"rootDir": root, "types": types,
                    "typeRoots": [root.join("node_modules/@types")]},
                "files": [root.join("runtime/node/stream/src/main.ts")],
                "include": []
            })
            .to_string(),
        )
        .unwrap();
        let snapshot = Frontend::new(Utf8PathBuf::from_path_buf(root.clone()).unwrap())
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&Utf8PathBuf::from_path_buf(config).unwrap())
            .unwrap();
        assert!(
            !snapshot.has_errors(),
            "{ambient}: {:?}",
            snapshot.diagnostics
        );
        // Absolute input locations are only locators: source identity remains
        // in the frontend's normalized workspace namespace in every pool tree.
        assert!(
            snapshot
                .sources
                .iter()
                .all(|source| !source.uri.contains(root.to_str().unwrap()))
        );
        for (mode, provider) in [
            ("native NoGC", Memory::NoGc),
            ("native RC", Memory::ReferenceCounting),
            ("JVM host GC", Memory::HostGc),
        ] {
            let prepared = hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::default()
                },
            )
            .unwrap_or_else(|failure| panic!("{ambient}/{mode}: {failure:?}"));
            assert!(
                prepared
                    .program
                    .layouts
                    .iter()
                    .any(|layout| layout.name == "Ctor_Error"),
                "{ambient}/{mode}: the actual Error constructor must survive preparation"
            );
        }
    }
}
