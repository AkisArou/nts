//! A merged global root can contain an ordinary source implementation.
#![allow(clippy::expect_used, clippy::unwrap_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{NodeKind, PropertyKey, SymbolFlags, syntax};
use std::num::NonZeroU16;

#[test]
fn an_ambient_namespace_does_not_replace_its_source_implementation() {
    let parent = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap();
    let root = scratch::ScratchDir::new(&parent, "global-source-body");
    std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","noEmit":true,"types":[]},"include":["*.ts"]}"#).unwrap();
    std::fs::write(
        root.join("ambient.d.ts"),
        "declare namespace Shared { interface Context { value: number; } }\n",
    )
    .unwrap();
    std::fs::write(root.join("main.ts"), "namespace Shared { export function operate(value: Context): number { return value.value + 1; } }\nconst result = Shared.operate({ value: 41 });\n").unwrap();
    let snapshot = Frontend::new(root.to_owned())
        .with_checkers(NonZeroU16::MIN)
        .snapshot(&root.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let global = snapshot
        .symbols
        .iter()
        .find(|symbol| symbol.name == PropertyKey::Name("Shared".into()))
        .expect("merged global namespace");
    assert!(global.flags.contains(SymbolFlags::GLOBAL_VALUE));
    assert!(!global.flags.contains(SymbolFlags::GLOBAL_TYPE));
    assert_eq!(global.declarations.len(), 2);
    assert_eq!(global.declaration_sites.len(), 2);
    assert!(global.library.is_none());
    let body = snapshot
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Syntax(syntax::FUNCTION_DECLARATION))
        .expect("the actual source function");
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.rejected.is_empty(), "{:?}", lowered.rejected);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    assert_eq!(lowered.program.refused_bodies().count(), 0);
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|function| function.origin.location == body.origin.location),
        "the source body's actual origin must survive lowering of a merged global root"
    );
}
