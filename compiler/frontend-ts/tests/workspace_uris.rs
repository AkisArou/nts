//! Portable source/module identities use the project root, including imports
//! from outside that directory and sources recorded only for diagnostics.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{PropertyKey, SemanticSnapshot};

struct Fixture(Utf8PathBuf);

impl Fixture {
    fn new(name: &str, helper: &str, options: &str) -> Self {
        let root = Utf8Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("workspace-uris-{}-{name}", std::process::id()));
        std::fs::create_dir_all(root.join("app/src")).unwrap();
        std::fs::create_dir_all(root.join("shared")).unwrap();
        std::fs::write(root.join("shared/helper.ts"), helper).unwrap();
        std::fs::write(
            root.join("app/src/main.ts"),
            "import { twice } from '../../shared/helper.ts';\nexport function work(n: number): number { return twice(n); }\n",
        ).unwrap();
        std::fs::write(root.join("app/tsconfig.json"), format!(
            r#"{{"compilerOptions":{{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"types":[],"allowImportingTsExtensions":true,"noEmit":true{options}}},"files":["src/main.ts"]}}"#
        )).unwrap();
        Self(root)
    }

    fn snapshot(&self, from_app: bool) -> SemanticSnapshot {
        let (cwd, config) = if from_app {
            (self.0.join("app"), Utf8Path::new("tsconfig.json"))
        } else {
            (self.0.clone(), Utf8Path::new("app/tsconfig.json"))
        };
        Frontend::new(cwd)
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(config)
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const HELPER: &str = "export function twice(n: number): number { const values = { '/absolute/key': 2 }; return n * values['/absolute/key']; }\n";

fn uris(snapshot: &SemanticSnapshot) -> Vec<&str> {
    snapshot
        .sources
        .iter()
        .map(|source| source.uri.as_str())
        .collect()
}

#[test]
fn outside_sources_and_module_names_are_relative_to_the_project() {
    let left = Fixture::new("left", HELPER, "");
    let right = Fixture::new("longer/deeper/right", HELPER, "");
    let a = left.snapshot(false);
    let b = right.snapshot(false);
    assert!(!a.has_errors(), "{:?}", a.diagnostics);
    assert!(!b.has_errors(), "{:?}", b.diagnostics);
    assert!(uris(&a).contains(&"nts-workspace:///../shared/helper.ts"));
    assert!(uris(&a).contains(&"nts-workspace:///src/main.ts"));
    assert_eq!(uris(&a), uris(&b));
    assert!(
        a.symbols.iter().any(|symbol| {
            matches!(&symbol.name, PropertyKey::Name(name) if name == "/absolute/key")
        }),
        "a written property key was treated as a module path"
    );
    assert_eq!(
        postcard::to_allocvec(&a.symbols).unwrap(),
        postcard::to_allocvec(&b.symbols).unwrap(),
        "module symbol identities depend on the absolute workspace path"
    );
    for symbol in &a.symbols {
        if let PropertyKey::Name(name) = &symbol.name {
            assert!(
                !name.contains(left.0.as_str()),
                "absolute module symbol: {name}"
            );
        }
    }
}

#[test]
fn resolution_working_directory_does_not_change_snapshot_identity() {
    let fixture = Fixture::new("cwd", HELPER, "");
    let from_parent = fixture.snapshot(false);
    let from_app = fixture.snapshot(true);
    assert_eq!(from_parent.sources, from_app.sources);
    assert_eq!(from_parent.digest().unwrap(), from_app.digest().unwrap());
    assert_eq!(
        nts_frontend_ts::entry_uris(&fixture.0.join("app/tsconfig.json"), &from_parent),
        ["nts-workspace:///src/main.ts"]
    );
}

#[cfg(unix)]
#[test]
fn symlinked_project_and_source_paths_have_the_real_projects_uris() {
    let fixture = Fixture::new("symlink", HELPER, ",\"preserveSymlinks\":true");
    let links = fixture.0.join("links/deeper");
    std::fs::create_dir_all(&links).unwrap();
    std::os::unix::fs::symlink(&fixture.0, links.join("workspace")).unwrap();
    std::os::unix::fs::symlink(fixture.0.join("shared"), links.join("helper-link")).unwrap();
    std::os::unix::fs::symlink(fixture.0.join("app/src"), links.join("source-link")).unwrap();
    std::fs::write(fixture.0.join("app/src/main.ts"),
        "import { twice } from '../../links/deeper/helper-link/helper.ts';\nexport function work(n: number): number { return twice(n); }\n"
    ).unwrap();
    let real = fixture.snapshot(false);
    assert!(!real.has_errors(), "{:?}", real.diagnostics);
    assert!(uris(&real).contains(&"nts-workspace:///../shared/helper.ts"));
    for config in [
        links.join("workspace/app/tsconfig.json"),
        links.join("source-link/../tsconfig.json"),
    ] {
        let linked = Frontend::new(fixture.0.clone())
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(!linked.has_errors(), "{:?}", linked.diagnostics);
        assert_eq!(uris(&real), uris(&linked));
        assert_eq!(real.digest().unwrap(), linked.digest().unwrap());
    }
}

#[test]
fn diagnostics_keep_real_paths_and_use_project_relative_identities() {
    let fixture = Fixture::new(
        "diagnostics",
        "export function twice(n: number): number { const invalid: number = 'wrong'; return n + invalid; }\n",
        ",\"sourceMap\":true,\"inlineSourceMap\":true",
    );
    let snapshot = fixture.snapshot(false);
    let typed = snapshot
        .diagnostics
        .iter()
        .find(|d| d.code == "TS2322")
        .unwrap();
    let source = &snapshot.sources[typed.primary.file.0 as usize];
    assert_eq!(source.uri, "nts-workspace:///../shared/helper.ts");
    assert_eq!(source.display_path, fixture.0.join("shared/helper.ts"));
    let config = snapshot
        .diagnostics
        .iter()
        .find(|d| d.code == "TS5053")
        .unwrap();
    let source = &snapshot.sources[config.primary.file.0 as usize];
    assert_eq!(source.uri, "nts-workspace:///tsconfig.json");
    assert_eq!(source.display_path, fixture.0.join("app/tsconfig.json"));
}

#[test]
fn a_missing_config_is_a_path_named_error() {
    let fixture = Fixture::new("missing-config", HELPER, "");
    let config = fixture.0.join("app/missing.json");
    let error = Frontend::new(fixture.0.clone())
        .snapshot(&config)
        .unwrap_err()
        .to_string();
    assert!(error.contains(config.as_str()), "{error}");
    assert!(error.contains("cannot resolve project config"), "{error}");
}
