//! Repeated captures observe missing files and changes in resolution precedence.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;

fn project(name: &str, source: &str) -> (Utf8PathBuf, Frontend) {
    let root = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("app")).unwrap();
    std::fs::create_dir_all(root.join("shared")).unwrap();
    std::fs::write(root.join("app/main.ts"), source).unwrap();
    std::fs::write(
        root.join("app/tsconfig.json"),
        r#"{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","strict":true,"types":[],"noEmit":true},"files":["main.ts"]}"#,
    )
    .unwrap();
    let frontend = Frontend::new(root.join("app")).with_checkers(std::num::NonZeroU16::MIN);
    (root, frontend)
}

#[test]
fn a_missing_sibling_file_is_resolved_on_the_next_capture() {
    let (root, mut frontend) = project(
        "native-missing-sibling",
        "export { answer } from '../shared/index';\n",
    );
    let config = root.join("app/tsconfig.json");
    let missing = frontend.snapshot(&config).unwrap();
    assert!(missing.diagnostics.iter().any(|d| d.code == "TS2307"));

    std::fs::write(root.join("shared/index.ts"), "export const answer = 7;\n").unwrap();
    let present = frontend.snapshot(&config).unwrap();
    assert!(!present.has_errors(), "{:?}", present.diagnostics);
    assert!(
        present
            .sources
            .iter()
            .any(|source| source.display_path == root.join("shared/index.ts"))
    );
    assert_ne!(missing.digest().unwrap(), present.digest().unwrap());
}

#[test]
fn a_new_file_can_replace_an_existing_directory_resolution_outside_the_config() {
    let (root, mut frontend) = project(
        "native-resolution-precedence",
        "export { answer } from '../shared/importer';\n",
    );
    std::fs::create_dir_all(root.join("shared/x")).unwrap();
    std::fs::write(
        root.join("shared/importer.ts"),
        "export { answer } from './x';\n",
    )
    .unwrap();
    std::fs::write(root.join("shared/x/index.ts"), "export const answer = 7;\n").unwrap();
    let config = root.join("app/tsconfig.json");
    let directory = frontend.snapshot(&config).unwrap();
    assert!(!directory.has_errors());
    assert!(
        directory
            .sources
            .iter()
            .any(|source| source.display_path == root.join("shared/x/index.ts"))
    );

    std::fs::write(root.join("shared/x.ts"), "export const answer = 11;\n").unwrap();
    let file = frontend.snapshot(&config).unwrap();
    assert!(!file.has_errors());
    assert!(
        file.sources
            .iter()
            .any(|source| source.display_path == root.join("shared/x.ts"))
    );
    assert!(
        !file
            .sources
            .iter()
            .any(|source| source.display_path == root.join("shared/x/index.ts"))
    );
    assert_ne!(directory.digest().unwrap(), file.digest().unwrap());
}
