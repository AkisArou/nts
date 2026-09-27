//! Which packages under `node_modules` the frontend reads: a platform
//! surface's declarations, and nothing else (`docs/nts-config.md` 3a).
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the
//! pinned binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::{SemanticSnapshot, SnapshotError};

/// A project whose one package, `@x/kit`, declares `objc:Kit`, with `nts` as
/// the package's `package.json` says it.
fn over_a_package(arm: &str, nts: &str) -> Option<Result<SemanticSnapshot, SnapshotError>> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-surfaces-{}-{arm}", std::process::id()));
    let package = dir.join("node_modules/@x/kit");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("package.json"), format!(r#"{{ "name": "@x/kit", "types": "index.d.ts"{nts} }}"#)).unwrap();
    std::fs::write(package.join("index.d.ts"), "declare module \"objc:Kit\" {\n  export class Kit {\n    count(): number;\n  }\n}\n").unwrap();
    std::fs::write(dir.join("main.ts"), "import { Kit } from \"objc:Kit\";\nexport function count(kit: Kit): number {\n  return kit.count();\n}\n").unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "strict": true, "noEmit": true, "target": "es2022", "module": "esnext", "types": ["@x/kit"] }, "files": ["main.ts"] }"#,
    )
    .unwrap();
    let tsconfig = dir.join("tsconfig.json").canonicalize_utf8().unwrap();
    Some(TsgoApi::new(tsgo).snapshot(&tsconfig))
}

fn reads_the_package(snapshot: &SemanticSnapshot) -> bool {
    snapshot.sources.iter().any(|source| source.uri.ends_with("node_modules/@x/kit/index.d.ts"))
}

/// **A package that says it is a platform surface is read**: its
/// declarations are what the program's `objc:Kit` means, and a backend needs
/// them as much as it needs the program's own.
#[test]
fn a_surface_packages_declarations_are_read() {
    let Some(snapshot) = over_a_package("surface", r#", "nts": { "surface": "objc" }"#) else { return };
    assert!(reads_the_package(&snapshot.expect("snapshot should succeed")));
}

/// Any other package under `node_modules` is not the program's, and is not
/// read.
#[test]
fn an_ordinary_package_is_not_read() {
    let Some(snapshot) = over_a_package("ordinary", "") else { return };
    assert!(!reads_the_package(&snapshot.expect("snapshot should succeed")));
}

/// A surface this compiler does not know is refused by name, not read as an
/// ordinary package, which would leave every name it declares unbound with
/// no word of why.
#[test]
fn an_unknown_surface_is_refused_by_name() {
    let Some(snapshot) = over_a_package("unknown", r#", "nts": { "surface": "cobol" }"#) else { return };
    match snapshot {
        Err(SnapshotError::Project(why)) => assert!(why.contains("\"cobol\""), "{why}"),
        other => panic!("an unknown surface was not refused: {:?}", other.map(|snapshot| snapshot.sources.len())),
    }
}
