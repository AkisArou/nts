//! Each native request observes newly present files, including outside the app.
#![allow(clippy::expect_used, clippy::unwrap_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::SemanticSnapshot;
use scratch::ScratchDir;

fn write(path: &Utf8Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project(name: &str, source: &str) -> ScratchDir {
    let root = ScratchDir::new(&Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")), name);
    write(
        &root.join("app/tsconfig.json"),
        r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]},"files":["main.ts"]}"#,
    );
    write(&root.join("app/main.ts"), source);
    root
}

fn capture(root: &Utf8Path) -> SemanticSnapshot {
    Frontend::new(root.join("app"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&root.join("app/tsconfig.json"))
        .unwrap()
}

#[test]
fn a_missing_sibling_module_is_observed_when_it_appears() {
    let root = project(
        "missing-sibling",
        "import {value} from '../shared/index'; export const answer = value;\n",
    );
    let before = capture(&root);
    assert!(
        before
            .diagnostics
            .iter()
            .any(|error| error.code == "TS2307")
    );
    let added = root.join("shared/index.ts");
    write(&added, "export const value = 1;\n");
    let after = capture(&root);
    assert!(!after.has_errors(), "{:?}", after.diagnostics);
    assert!(
        after
            .sources
            .iter()
            .any(|source| source.display_path == added)
    );
}

#[test]
fn a_new_sibling_file_replaces_a_previously_resolved_directory_index() {
    let root = project(
        "preferred-sibling",
        "import {value} from '../shared/importer'; export const answer = value;\n",
    );
    write(
        &root.join("shared/importer.ts"),
        "export {value} from './x';\n",
    );
    let index = root.join("shared/x/index.ts");
    write(&index, "export const value = 1;\n");
    let before = capture(&root);
    assert!(!before.has_errors(), "{:?}", before.diagnostics);
    assert!(
        before
            .sources
            .iter()
            .any(|source| source.display_path == index)
    );
    let preferred = root.join("shared/x.ts");
    write(&preferred, "export const value = 2;\n");
    let after = capture(&root);
    assert!(!after.has_errors(), "{:?}", after.diagnostics);
    assert!(
        after
            .sources
            .iter()
            .any(|source| source.display_path == preferred)
    );
    assert!(
        !after
            .sources
            .iter()
            .any(|source| source.display_path == index)
    );
}
