//! The stamped crate set is checked independently against workspace metadata.

#[path = "../build_support.rs"]
mod build_support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

#[test]
fn every_frontend_workspace_dependency_is_stamped() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("root");
    let result = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--offline",
            "--no-deps",
            "--format-version",
            "1",
        ])
        .current_dir(&root)
        .output()
        .expect("cargo metadata");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let metadata: serde_json::Value = serde_json::from_slice(&result.stdout).expect("metadata");
    let packages: BTreeMap<_, _> = metadata["packages"]
        .as_array()
        .expect("packages")
        .iter()
        .map(|p| (p["name"].as_str().expect("name"), p))
        .collect();
    let mut wanted = BTreeSet::new();
    let mut pending = vec!["nts-frontend-ts"];
    while let Some(name) = pending.pop() {
        if !wanted.insert(name) {
            continue;
        }
        let package = packages[name];
        for dependency in package["dependencies"].as_array().expect("dependencies") {
            if dependency["kind"].as_str() == Some("dev") {
                continue;
            }
            let name = dependency["name"].as_str().expect("dependency name");
            if packages.contains_key(name) {
                pending.push(name);
            }
        }
    }
    let actual: BTreeSet<_> = build_support::CRATES
        .iter()
        .map(|&(name, dir)| {
            let package = packages[name];
            let manifest = Path::new(package["manifest_path"].as_str().expect("manifest"));
            assert_eq!(
                manifest
                    .parent()
                    .expect("crate")
                    .strip_prefix(&root)
                    .expect("workspace crate"),
                Path::new(dir)
            );
            name
        })
        .collect();
    assert_eq!(
        actual, wanted,
        "a new workspace dependency must enter the frontend stamp"
    );
}

#[test]
fn stamp_names_content_and_configuration_but_not_copy_metadata() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("root");
    let input = build_support::inputs(&root).expect("all producer sources");
    let cfg = vec![("feature".into(), "on".into())];
    let first = build_support::stamp(&input, &cfg);
    assert_eq!(first, build_support::stamp(&input.clone(), &cfg));
    assert!(
        input
            .iter()
            .all(|(p, _)| !p.contains("compiler/core/") && !Path::new(p).is_absolute())
    );
    for prefix in [
        "compiler/frontend-ts/src/",
        "compiler/frontend-tsrs/src/",
        "compiler/semantic-schema/src/",
        "compiler/diagnostics/src/",
    ] {
        let mut changed = input.clone();
        changed
            .iter_mut()
            .find(|(p, _)| p.starts_with(prefix))
            .expect("crate input")
            .1
            .push(b'!');
        assert_ne!(first, build_support::stamp(&changed, &cfg), "{prefix}");
    }
    let mut changed = input.clone();
    changed.push((
        "compiler/frontend-ts/src/new.rs".into(),
        b"new code".to_vec(),
    ));
    assert_ne!(first, build_support::stamp(&changed, &cfg));
    let mut changed = input.clone();
    changed.remove(0);
    assert_ne!(first, build_support::stamp(&changed, &cfg));
    assert_ne!(first, build_support::stamp(&input, &[]));
}

#[test]
fn source_discovery_tracks_files_and_ignores_checkout_and_mtime() {
    struct Scratch(std::path::PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let scratch =
        Scratch(std::env::temp_dir().join(format!("nts-stamp-inputs-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&scratch.0);
    let a = scratch.0.join("a");
    let b = scratch.0.join("b");
    std::fs::create_dir_all(&a).expect("workspace");
    for name in ["Cargo.toml", "Cargo.lock"] {
        std::fs::write(a.join(name), name).expect("manifest");
    }
    for &(name, dir) in build_support::CRATES {
        std::fs::create_dir_all(a.join(dir).join("src")).expect("crate");
        std::fs::write(a.join(dir).join("Cargo.toml"), name).expect("manifest");
        std::fs::write(a.join(dir).join("src/one.rs"), name).expect("source");
    }
    for name in ["build.rs", "build_support.rs"] {
        std::fs::write(a.join("compiler/frontend-ts").join(name), name).expect("build source");
    }
    let first = build_support::inputs(&a).expect("inputs");
    let stamp = build_support::stamp(&first, &[]);
    // Reverse creation order, another absolute root, and new inode/timestamps.
    for (path, bytes) in first.iter().rev() {
        let path = b.join(path);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("directory");
        std::fs::write(path, bytes).expect("copy");
    }
    assert_eq!(first, build_support::inputs(&b).expect("copied inputs"));
    let source = a.join("compiler/frontend-ts/src/one.rs");
    let bytes = std::fs::read(&source).expect("source");
    std::fs::File::options()
        .write(true)
        .open(&source)
        .expect("open")
        .set_modified(std::time::SystemTime::now() - std::time::Duration::from_hours(24))
        .expect("mtime");
    assert_eq!(
        stamp,
        build_support::stamp(&build_support::inputs(&a).expect("inputs"), &[])
    );
    std::fs::write(&source, "changed producer").expect("edit");
    assert_ne!(
        stamp,
        build_support::stamp(&build_support::inputs(&a).expect("inputs"), &[])
    );
    std::fs::write(&source, &bytes).expect("restore");
    let added = a.join("compiler/frontend-ts/src/added.rs");
    std::fs::write(&added, "a new module").expect("add");
    assert_ne!(
        stamp,
        build_support::stamp(&build_support::inputs(&a).expect("inputs"), &[])
    );
    std::fs::remove_file(added).expect("remove addition");
    assert_eq!(
        stamp,
        build_support::stamp(&build_support::inputs(&a).expect("inputs"), &[])
    );
    std::fs::remove_file(&source).expect("remove source");
    assert_ne!(
        stamp,
        build_support::stamp(&build_support::inputs(&a).expect("inputs"), &[])
    );
    std::fs::remove_file(a.join("Cargo.lock")).expect("missing declared input");
    assert!(
        build_support::inputs(&a).is_err(),
        "a missing declared input must not produce a stamp"
    );
}
