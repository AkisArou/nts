//! The native builder owns exactly the requested program's source graph.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::num::NonZeroU16;

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_tsrs::{self as native, ProjectSpec, SessionOptions};

use super::*;

fn root() -> &'static Utf8Path {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
}

fn capture_project(config: Utf8PathBuf, count: u16) -> SemanticSnapshot {
    capture_project_and_diagnostics(config, count, 1).0
}

fn capture_project_and_diagnostics(
    config: Utf8PathBuf,
    count: u16,
    roots: usize,
) -> (SemanticSnapshot, Vec<native::Diagnostic>) {
    let mut options = SessionOptions::new(root());
    options.checker_count = NonZeroU16::new(count);
    native::run(options, move |session| {
        let checked = session
            .open(ProjectSpec::new(config))
            .expect("requested config");
        assert_eq!(
            checked.projects().len(),
            1,
            "referenced programs are not merged"
        );
        let paths: Vec<_> = checked
            .projects()
            .next()
            .unwrap()
            .files()
            .filter(|file| !file.is_default_library() && !file.is_external_library())
            .map(|file| file.path().to_owned())
            .collect();
        let checked = checked.start_diagnostics(native::DiagnosticScope::Files(&paths));
        let project = checked.projects().next().unwrap();
        assert_eq!(project.root_paths().len(), roots);
        let files = project
            .files()
            .filter(|file| !file.is_default_library() && !file.is_external_library());
        let project_root = project
            .config_path()
            .parent()
            .unwrap()
            .canonicalize_utf8()
            .unwrap();
        let mut snapshot = Capture::syntax(&project_root, files, project.semantics())
            .unwrap()
            .finish()
            .unwrap();
        let finished = checked.finish();
        append_diagnostics(
            &mut snapshot,
            &project_root,
            finished.projects().next().unwrap(),
            finished.diagnostics(),
        )
        .unwrap();
        (snapshot, finished.diagnostics())
    })
}

#[test]
fn phase_import_queries_preserve_the_call_and_pristine_diagnostics() {
    let config = root().join("tests/workspace/phase-import-capture/tsconfig.json");
    for count in [1, 4] {
        let (snapshot, diagnostics) = capture_project_and_diagnostics(config.clone(), count, 1);
        let mut options = SessionOptions::new(root());
        options.checker_count = NonZeroU16::new(count);
        let pristine = native::run(options, |session| {
            let checked = session.open(ProjectSpec::new(config.clone())).unwrap();
            let paths: Vec<_> = checked
                .projects()
                .flat_map(native::Project::files)
                .filter(|file| !file.is_default_library() && !file.is_external_library())
                .map(|file| file.path().to_owned())
                .collect();
            checked
                .start_diagnostics(native::DiagnosticScope::Files(&paths))
                .finish()
                .diagnostics()
        });
        assert_eq!(diagnostics, pristine);
        let mut forms = Vec::new();
        for (index, node) in snapshot.nodes.iter().enumerate() {
            if node.kind
                != nts_semantic_schema::NodeKind::Syntax(nts_semantic_schema::syntax::META_PROPERTY)
            {
                continue;
            }
            let (nts_semantic_schema::NodeData::Flags { small }
            | nts_semantic_schema::NodeData::Children { small, .. }) = node.data
            else {
                panic!("typed meta-property payload");
            };
            forms.push(small);
            let id = NodeId(u32::try_from(index).unwrap());
            if small >= 2 {
                assert!(node.symbol.is_none());
                assert!(!snapshot.node_types.contains_key(&id));
                let call = node.parent.unwrap();
                assert!(
                    snapshot.node_types.contains_key(&call),
                    "phase call result is still captured"
                );
            } else {
                assert!(
                    snapshot.node_types.contains_key(&id),
                    "ordinary import.meta/new.target control"
                );
            }
        }
        assert_eq!(forms, [2, 3, 0, 1]);
    }
}

#[test]
fn the_raw_checker_audit_matches_capture_with_includes_and_a_real_error() {
    for (config_name, error_count) in [("tsconfig.json", 1), ("control.json", 0)] {
        let config = root()
            .join("tests/workspace/diagnostic-audit-inputs")
            .join(config_name);
        for count in [1, 4] {
            let (snapshot, captured) = capture_project_and_diagnostics(config.clone(), count, 3);
            assert!(
                !snapshot.semantics.no_implicit_any,
                "audit input remains non-strict"
            );
            assert!(
                snapshot
                    .semantics
                    .disabled_strict_sources
                    .iter()
                    .any(|source| source.name == "noImplicitAny"
                        && source.configuration.ends_with(config_name)),
                "strict provenance is observable without changing native diagnostics"
            );
            let mut options = SessionOptions::new(root());
            options.checker_count = NonZeroU16::new(count);
            let pristine = native::run(options, |session| {
                let checked = session.open(ProjectSpec::new(config.clone())).unwrap();
                let paths: Vec<_> = checked
                    .projects()
                    .flat_map(native::Project::files)
                    .filter(|file| !file.is_default_library())
                    .map(|file| file.path().to_owned())
                    .collect();
                checked
                    .start_diagnostics(native::DiagnosticScope::Files(&paths))
                    .finish()
                    .diagnostics()
            });
            assert_eq!(captured, pristine, "full owned diagnostic vector");
            assert_eq!(
                pristine
                    .iter()
                    .filter(|diagnostic| diagnostic.code == 2322)
                    .count(),
                error_count
            );
        }
    }
}

#[test]
fn the_workspace_snapshot_retains_referenced_sources_in_the_requested_program() {
    let config = root().join("tests/workspace/apps/node/tsconfig.json");
    let snapshot = capture_project(config, 1);
    let mut paths: Vec<_> = snapshot
        .sources
        .iter()
        .map(|source| source.display_path.strip_prefix(root()).unwrap().as_str())
        .collect();
    paths.sort_unstable();
    assert_eq!(
        paths,
        [
            "tests/workspace/apps/node/src/main.ts",
            "tests/workspace/packages/crypto-core/src/index.ts",
            "tests/workspace/packages/storage/src/index.ts",
        ]
    );
    assert_eq!(snapshot.modules.len(), 3);
    let application = snapshot
        .modules
        .iter()
        .find(|module| {
            snapshot.sources[module.file.0 as usize]
                .display_path
                .ends_with("apps/node/src/main.ts")
        })
        .unwrap();
    let mut imported: Vec<_> = application
        .imports
        .iter()
        .map(|id| {
            let target = &snapshot.modules[id.0 as usize];
            snapshot.sources[target.file.0 as usize]
                .display_path
                .strip_prefix(root())
                .unwrap()
                .as_str()
        })
        .collect();
    imported.sort_unstable();
    assert_eq!(
        imported,
        [
            "tests/workspace/packages/crypto-core/src/index.ts",
            "tests/workspace/packages/storage/src/index.ts",
        ],
        "module edges follow the checker's resolved specifier symbols"
    );
    snapshot
        .validate()
        .expect("all captured declaration and arena IDs belong to this program");
}

#[test]
fn written_member_names_keep_program_underscores_without_checker_escapes() {
    use nts_semantic_schema::TypeKind;

    let config =
        root().join("tests/programs/a-field-whose-name-starts-with-two-underscores/tsconfig.json");
    let one = capture_project(config.clone(), 1);
    let four = capture_project(config, 4);
    assert_eq!(one.digest().unwrap(), four.digest().unwrap());
    let names: std::collections::BTreeSet<_> = one
        .types
        .iter()
        .flat_map(|record| match &record.kind {
            TypeKind::Object { properties } => properties
                .iter()
                .filter_map(|property| property.name.public_name())
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        })
        .collect();
    for name in [
        "__snapshot",
        "_snapshot",
        "snapshot",
        "__reactInternalSnapshotBeforeUpdate",
        "___three",
        "__bump",
        "__tag",
    ] {
        assert!(
            names.contains(name),
            "the snapshot must keep written member {name}"
        );
    }
    assert!(
        !names.contains("___snapshot"),
        "the checker's escape must not leak into layouts"
    );
    assert!(!names.contains("____three"));
    let parameters: Vec<_> = one
        .signatures
        .iter()
        .flat_map(|signature| &signature.parameters)
        .collect();
    assert!(
        parameters
            .iter()
            .any(|parameter| parameter.name == "__given")
    );
    assert!(
        !parameters
            .iter()
            .any(|parameter| parameter.name == "___given")
    );
}

#[test]
fn private_members_keep_their_written_name_and_declaration_identity_at_one_and_four_checkers() {
    use nts_semantic_schema::TypeKind;

    let config = root().join("tests/programs/two-private-names-that-collide/tsconfig.json");
    let one = capture_project(config.clone(), 1);
    let four = capture_project(config, 4);
    if let Ok(directory) = std::env::var("NTS_NATIVE_CHECKER_DUMP") {
        let directory = std::path::Path::new(&directory);
        std::fs::create_dir_all(directory).unwrap();
        std::fs::write(
            directory.join("private-one.json"),
            serde_json::to_vec_pretty(&one).unwrap(),
        )
        .unwrap();
        std::fs::write(
            directory.join("private-four.json"),
            serde_json::to_vec_pretty(&four).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(one.digest().unwrap(), four.digest().unwrap());
    let mut declarations = std::collections::BTreeSet::new();
    for name in ["Base", "Derived", "Deeper"] {
        let own_private: Vec<_> = one
            .types
            .iter()
            .filter(|record| {
                record
                    .symbol
                    .is_some_and(|id| one.symbols[id.0 as usize].name.is_name(name))
            })
            .filter_map(|record| match &record.kind {
                TypeKind::Object { properties } => Some(properties),
                _ => None,
            })
            .flatten()
            .filter(|property| matches!(&property.name, nts_semantic_schema::PropertyKey::Private(name) if name == "#count") && property.own)
            .collect();
        assert!(
            !own_private.is_empty(),
            "{name} owns its own written #count member"
        );
        for property in own_private {
            declarations.insert(property.declaration.expect("a source declaration"));
        }
    }
    assert_eq!(
        declarations.len(),
        3,
        "three written #count members belong to three declarations"
    );
}

#[test]
fn native_semantic_capture_is_independent_of_the_checker_pool_size() {
    let config = root().join("tests/programs/hello/tsconfig.json");
    let one = capture_project(config.clone(), 1);
    let four = capture_project(config, 4);
    assert_eq!(one.digest().unwrap(), four.digest().unwrap());
    assert_eq!(one.diagnostics, four.diagnostics);
    assert!(!one.has_errors());
}

#[test]
fn provided_views_keep_their_runtime_storage_without_expanding_the_library() {
    use nts_semantic_schema::TypeKind;

    let snapshot = capture_project(
        root().join("tests/programs/open-typed-values/tsconfig.json"),
        1,
    );
    assert!(
        !snapshot
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS0003")
    );
    let views: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            snapshot.provided_name(TypeId(u32::try_from(*index).unwrap())) == Some("Uint16Array")
        })
        .collect();
    assert!(
        !views.is_empty(),
        "the narrowed view must have a captured type"
    );
    assert!(
        views
            .iter()
            .all(|(_, record)| matches!(record.kind, TypeKind::Structured)),
        "a view's storage is supplied by nts, not lib.d.ts's member list"
    );
    let library_types = snapshot
        .types
        .iter()
        .filter(|record| {
            record
                .symbol
                .is_some_and(|id| snapshot.symbols[id.0 as usize].library.is_some())
        })
        .count();
    println!(
        "open-typed-values: {} types, {library_types} library types",
        snapshot.types.len()
    );
}

#[test]
fn native_diagnostics_are_real_errors_and_deterministic_at_one_and_four_checkers() {
    let config = root().join("tests/programs/invalid/tsconfig.json");
    let one = capture_project(config.clone(), 1);
    let four = capture_project(config, 4);
    assert!(
        one.has_errors(),
        "the builder must retain the checker's diagnostics"
    );
    assert!(
        one.diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "TS2322")
    );
    assert_eq!(one.diagnostics, four.diagnostics);
    for diagnostic in &one.diagnostics {
        assert!(
            one.sources
                .get(diagnostic.primary.file.0 as usize)
                .is_some()
        );
    }
}

#[test]
fn large_native_modules_have_complete_bounded_type_graphs() {
    // This is the same runtime set as integrity --runtime, plus the largest
    // React project. The program corpus alone never captures these modules.
    let mut configs: Vec<_> = std::fs::read_dir(root().join("runtime/node"))
        .unwrap()
        .map(Result::unwrap)
        .map(|entry| {
            Utf8PathBuf::from_path_buf(entry.path())
                .unwrap()
                .join("tsconfig.json")
        })
        .filter(|config| config.is_file())
        .collect();
    configs.extend([
        root().join("runtime/web-platform/tsconfig.json"),
        root().join("runtime/react/packages/react-reconciler/tsconfig.json"),
    ]);
    configs.sort();
    assert!(
        configs.len() >= 27,
        "the runtime capture guard must have inputs"
    );
    let mut problems = Vec::new();
    for config in configs {
        let mut frontend = crate::Frontend::new(root()).with_checkers(NonZeroU16::MIN);
        let snapshot = frontend.snapshot(&config).unwrap();
        let reached = nts_semantic_schema::reachability::for_frontend(&snapshot);
        eprintln!(
            "{config}: recorded={}, reachable seeds={}, errors={}",
            snapshot.types.len(),
            reached.types.len(),
            frontend.stats().errors
        );
        if snapshot
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS0003")
        {
            problems.push(format!("{config}: a partial type graph"));
        }
        // A bounded amount of declared structure may sit outside the reached
        // contracts. Eager recursive instantiation used to make fs exceed 16x.
        if snapshot.types.len() > reached.types.len().max(1) * 4 {
            problems.push(format!(
                "{config}: {} recorded / {} reached types exceeds 4x",
                snapshot.types.len(),
                reached.types.len()
            ));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn recursive_generic_library_and_user_returns_capture_without_forcing_a_closure() {
    for config in [
        "compiler/frontend-ts/tests/programs/recursive-array-flat/tsconfig.json",
        "tests/programs/a-generic-recursive-return-is-only-expanded-when-called/tsconfig.json",
    ] {
        let mut frontend = crate::Frontend::new(root()).with_checkers(NonZeroU16::MIN);
        let snapshot = frontend.snapshot(&root().join(config)).unwrap();
        eprintln!("{config}: recorded={}", snapshot.types.len());
        assert!(
            !snapshot.has_errors(),
            "{config}: {:?}",
            snapshot.diagnostics
        );
        assert!(
            !snapshot
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "NTS0003"),
            "{config}: {:?}",
            snapshot.diagnostics
        );
        assert!(
            snapshot.types.len() < 1024,
            "{config}: {} types",
            snapshot.types.len()
        );
    }
}

#[test]
fn repeated_module_paths_resolve_once_per_capture() {
    let root = root().canonicalize_utf8().unwrap();
    native::run(SessionOptions::new(&root), |session| {
        let checked = session
            .open(ProjectSpec::new(
                root.join("tests/workspace/phase-import-capture/tsconfig.json"),
            ))
            .unwrap();
        let project = checked.projects().next().unwrap();
        let path = project
            .files()
            .find(|file| !file.is_default_library())
            .unwrap()
            .path()
            .to_owned();
        let mut capture = Capture::syntax(&root, [], project.semantics()).unwrap();
        let expected = capture.workspace_uri(&path).unwrap();
        for _ in 0..8 {
            assert_eq!(capture.workspace_uri(&path).unwrap(), expected);
        }
        assert_eq!(capture.workspace_uri_resolutions, 1);
        // Evicting the cached identity forces a fresh filesystem resolution.
        capture.workspace_uris.clear();
        assert_eq!(capture.workspace_uri(&path).unwrap(), expected);
        assert_eq!(capture.workspace_uri_resolutions, 2);
    });
}
