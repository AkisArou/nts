//! Acquisition against a fixture that has one of each shape in it.
//!
//! The fixture is built in a temporary directory rather than checked in,
//! because what is being tested is a *layout* — a symlinked workspace package,
//! a package that ships TypeScript, a package that ships only a source map, a
//! package that ships neither — and a checked-in symlink farm is harder to read
//! than the code that makes one.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;

use camino::{Utf8Path, Utf8PathBuf};

fn write(at: &Utf8Path, text: &str) {
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(at, text).unwrap();
}

/// A workspace with two packages and four dependencies.
fn fixture(name: &str) -> Utf8PathBuf {
    let root = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    write(&root.join("pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    write(&root.join("package.json"), r#"{"name":"ws","private":true}"#);

    // The developer's own sibling package.
    write(
        &root.join("packages/lib/package.json"),
        r#"{"name":"@ws/lib","version":"1.0.0","exports":{".":"./src/index.ts"}}"#,
    );
    write(
        &root.join("packages/lib/src/index.ts"),
        "export const one = 1;\n",
    );

    // The application.
    write(
        &root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{
             "@ws/lib":"workspace:*","shipped":"1.0.0","mapped":"1.0.0",
             "opaque":"1.0.0","legacy":"1.0.0"}}"#,
    );
    write(&root.join("packages/app/tsconfig.json"), r#"{"include":["src"]}"#);
    write(&root.join("packages/app/src/main.ts"), "export const x = 1;\n");

    let modules = root.join("packages/app/node_modules");
    std::fs::create_dir_all(modules.join("@ws")).unwrap();
    std::os::unix::fs::symlink("../../../lib", modules.join("@ws/lib")).unwrap();

    // Ships its TypeScript, and imports a second file from it.
    write(
        &modules.join("shipped/package.json"),
        r#"{"name":"shipped","version":"1.0.0","exports":{".":{"source":"./src/index.ts","default":"./dist/index.js"}}}"#,
    );
    write(
        &modules.join("shipped/src/index.ts"),
        "export { helper } from \"./nested/helper.js\";\n",
    );
    write(
        &modules.join("shipped/src/nested/helper.ts"),
        "export const helper = 1;\n",
    );
    // Not imported from the entry, so it must not be copied.
    write(&modules.join("shipped/src/unused.ts"), "export const nope = 1;\n");
    write(&modules.join("shipped/dist/index.js"), "export const x = 1;\n");

    // Ships generated JavaScript with its original source embedded.
    write(
        &modules.join("mapped/package.json"),
        r#"{"name":"mapped","version":"2.0.0","main":"./dist/index.js"}"#,
    );
    write(
        &modules.join("mapped/dist/index.js"),
        "export const x=1;\n//# sourceMappingURL=index.js.map\n",
    );
    write(
        &modules.join("mapped/dist/index.js.map"),
        r#"{"version":3,"sources":["../src/index.ts"],"sourcesContent":["export const x: number = 1;\n"],"mappings":""}"#,
    );

    // Ships generated JavaScript and a map with a hole in it.
    write(
        &modules.join("opaque/package.json"),
        r#"{"name":"opaque","version":"3.0.0","main":"./index.js"}"#,
    );
    write(
        &modules.join("opaque/index.js"),
        "export const x=1;\n//# sourceMappingURL=index.js.map\n",
    );
    write(
        &modules.join("opaque/index.js.map"),
        r#"{"version":3,"sources":["../src/a.ts","../src/b.ts"],"sourcesContent":["export const a = 1;\n",null],"mappings":""}"#,
    );

    // Extensionless `main`, which predates extensions being required.
    write(
        &modules.join("legacy/package.json"),
        r#"{"name":"legacy","version":"4.0.0","main":"./index"}"#,
    );
    write(&modules.join("legacy/index.js"), "module.exports = 1;\n");

    root
}

fn acquire(root: &Utf8Path) -> nts_deps::Acquisition {
    let project = root.join("packages/app");
    let tsconfig = project.join("tsconfig.json");
    nts_deps::acquire(&project, &tsconfig, &nts_deps::Options::default())
        .expect("acquisition succeeds")
}

fn route_of<'a>(acquisition: &'a nts_deps::Acquisition, name: &str) -> &'a nts_deps::recover::Route {
    &acquisition
        .packages
        .iter()
        .find(|package| package.name == name)
        .unwrap_or_else(|| panic!("`{name}` is in the closure"))
        .route
}

fn paths(root: &Utf8Path) -> BTreeMap<String, String> {
    let text = std::fs::read_to_string(root.join("packages/app/tsconfig.nts.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    value["compilerOptions"]["paths"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v[0].as_str().unwrap().to_owned()))
        .collect()
}

#[test]
fn each_shape_gets_the_route_it_deserves() {
    let root = fixture("routes");
    let acquisition = acquire(&root);

    assert_eq!(
        *route_of(&acquisition, "shipped"),
        nts_deps::recover::Route::ShippedTypeScript
    );
    assert_eq!(
        *route_of(&acquisition, "mapped"),
        nts_deps::recover::Route::SourceMap
    );
    // A map with a `null` in `sourcesContent` is half a module graph, and half
    // a module graph is a refusal rather than a partial success.
    assert!(matches!(
        route_of(&acquisition, "opaque"),
        nts_deps::recover::Route::MapIncomplete { have: 1, want: 2 }
    ));
    assert_eq!(
        *route_of(&acquisition, "legacy"),
        nts_deps::recover::Route::JavaScriptOnly,
        "`main: ./index` names `index.js`, which is JavaScript and not recoverable"
    );
    assert_eq!(acquisition.acquired(), 3, "@ws/lib, shipped, mapped");
}

/// The developer's own package is pointed at, never copied: a snapshot of it
/// would go stale on the next edit.
#[test]
fn a_workspace_package_is_not_vendored() {
    let root = fixture("workspace");
    let acquisition = acquire(&root);

    let lib = acquisition
        .packages
        .iter()
        .find(|package| package.name == "@ws/lib")
        .expect("the sibling is in the closure");
    assert_eq!(lib.origin, nts_deps::Origin::Workspace);
    assert_eq!(lib.files, 0, "nothing is copied for a workspace package");

    assert_eq!(
        paths(&root)["@ws/lib"],
        "../lib/src/index.ts",
        "it resolves where it lives"
    );
    assert!(
        !root.join(".nts/vendor/@ws__lib@1.0.0").exists(),
        "and there is no copy of it in the vendor tree"
    );
}

/// Only what the entry reaches. A package's own tests and unreferenced files
/// are not part of the program and must not be copied into it.
#[test]
fn a_shipped_package_contributes_only_what_its_entry_imports() {
    let root = fixture("reachable");
    acquire(&root);

    let vendor = root.join(".nts/vendor/shipped@1.0.0");
    assert!(vendor.join("src/index.ts").is_file());
    assert!(
        vendor.join("src/nested/helper.ts").is_file(),
        "`./nested/helper.js` resolves to `helper.ts`, the way TypeScript resolves it"
    );
    assert!(
        !vendor.join("src/unused.ts").exists(),
        "nothing imports it, so it is not in the program"
    );
}

/// The program's root is the workspace, because both kinds of dependency —
/// a vendored tree and a sibling package — live above the importing package.
#[test]
fn the_generated_config_roots_the_program_at_the_workspace() {
    let root = fixture("rootdir");
    acquire(&root);

    let text = std::fs::read_to_string(root.join("packages/app/tsconfig.nts.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["compilerOptions"]["rootDir"], "../..");
    assert_eq!(value["extends"], "./tsconfig.json");
    assert!(
        value["compilerOptions"]["baseUrl"].is_null(),
        "TypeScript 7 removed `baseUrl`; declaring one is an error, and without \
         it `paths` resolve relative to this file, which is what they are written for"
    );
}

/// The developer's files are read and never written.
#[test]
fn nothing_the_developer_owns_is_modified() {
    let root = fixture("untouched");
    let before: Vec<(Utf8PathBuf, String)> = [
        "packages/app/tsconfig.json",
        "packages/app/package.json",
        "packages/lib/package.json",
        "package.json",
    ]
    .into_iter()
    .map(|at| {
        let path = root.join(at);
        let text = std::fs::read_to_string(&path).unwrap();
        (path, text)
    })
    .collect();

    acquire(&root);

    for (path, text) in before {
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            text,
            "`{path}` must be read and not written"
        );
    }
}

/// A second run with nothing changed writes nothing and says so.
#[test]
fn acquisition_is_idempotent() {
    let root = fixture("idempotent");
    let first = acquire(&root);
    assert!(first.files_written > 0, "the first run has work to do");

    let second = acquire(&root);
    assert_eq!(second.files_written, 0);
    assert!(second.unchanged, "and it reports that it had nothing to do");
    assert_eq!(first.acquired(), second.acquired());
}

/// A dependency that leaves the graph takes its vendored source with it:
/// source that still resolves after the package is gone would compile a
/// program against something the developer removed.
#[test]
fn a_removed_dependency_is_pruned() {
    let root = fixture("prune");
    acquire(&root);
    assert!(root.join(".nts/vendor/mapped@2.0.0").is_dir());

    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"shipped":"1.0.0"}}"#,
    )
    .unwrap();
    let after = acquire(&root);

    assert!(after.pruned.contains(&"mapped@2.0.0".to_owned()));
    assert!(!root.join(".nts/vendor/mapped@2.0.0").exists());
    assert!(root.join(".nts/vendor/shipped@1.0.0").is_dir());
}

/// A declared dependency nobody installed is reported, not fatal.
#[test]
fn a_missing_dependency_is_named() {
    let root = fixture("missing");
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"absent":"1.0.0"}}"#,
    )
    .unwrap();

    let acquisition = acquire(&root);
    assert_eq!(acquisition.missing, vec!["absent".to_owned()]);
}

/// The nearest workspace declaration wins. A checkout living inside somebody
/// else's monorepo anchors at its own root, not at theirs — otherwise every
/// generated path grows a `../..` per level of accident.
#[test]
fn the_nearest_workspace_declaration_wins() {
    let base = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("nearest");
    let inner = base.join("outer/inner/packages/app");
    std::fs::create_dir_all(&inner).unwrap();
    std::fs::write(base.join("outer/pnpm-workspace.yaml"), "packages:\n").unwrap();
    std::fs::write(base.join("outer/inner/pnpm-workspace.yaml"), "packages:\n").unwrap();

    assert_eq!(nts_deps::workspace::root(&inner), base.join("outer/inner"));
}

/// A project with nothing acquirable is left exactly as it was found. A
/// generated config that only re-states `extends` is a file the developer did
/// not ask for and has to wonder about.
#[test]
fn nothing_to_map_writes_nothing() {
    let root = fixture("empty");
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"legacy":"1.0.0"}}"#,
    )
    .unwrap();

    let acquisition = acquire(&root);
    assert_eq!(acquisition.acquired(), 0);
    assert!(acquisition.tsconfig.is_none());
    assert!(!root.join("packages/app/tsconfig.nts.json").exists());
}

/// `extends` must name the developer's config from beside the generated one.
///
/// It did not: `strip_prefix` on a relative argument against a canonicalised
/// project silently fell through to the whole given path, so pointing the tool
/// at `examples/library/tsconfig.json` produced
/// `extends: ./examples/library/tsconfig.json` — which resolves to nothing and
/// inherits nothing, and the failure surfaced three directories away as
/// "an import path can only end with '.ts' when allowImportingTsExtensions is
/// enabled".
#[test]
fn extends_names_the_config_beside_it_even_from_a_relative_path() {
    let root = fixture("extends");
    let relative = Utf8PathBuf::from("packages/app/tsconfig.json");
    // The only test here that touches the process-wide working directory, and
    // it restores it before asserting so a failure cannot strand the others.
    let previous = std::env::current_dir().unwrap();
    std::env::set_current_dir(&root).unwrap();
    let result = nts_deps::acquire(
        Utf8Path::new("packages/app"),
        &relative,
        &nts_deps::Options::default(),
    );
    std::env::set_current_dir(previous).unwrap();
    result.expect("acquisition succeeds");

    let text = std::fs::read_to_string(root.join("packages/app/tsconfig.nts.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["extends"], "./tsconfig.json");
}

/// A composite project must list every one of its files, so a dependency
/// reached only by an import is rejected with TS6307. Projects inherit
/// `composite: true` from a shared base all the time, so the generated config
/// switches the whole emit group off rather than leaving the developer to
/// discover it.
#[test]
fn the_generated_config_is_not_a_composite_project() {
    let root = fixture("composite");
    acquire(&root);

    let text = std::fs::read_to_string(root.join("packages/app/tsconfig.nts.json")).unwrap();
    let options = &serde_json::from_str::<serde_json::Value>(&text).unwrap()["compilerOptions"];
    assert_eq!(options["composite"], false);
    assert_eq!(options["noEmit"], true);
    // `emitDeclarationOnly` and `noEmit` cannot both be set, so the group has
    // to move together.
    assert_eq!(options["emitDeclarationOnly"], false);
    assert_eq!(options["declaration"], false);
    assert_eq!(options["incremental"], false);
}

/// A `tsc`-style build emits one file per input, so the entry's own map carries
/// the entry and nothing else. Recovering only that leaves a package whose
/// every sibling import resolves to nothing — `minimatch` arrived as
/// `src/index.ts` alone with five dangling imports, and looked exactly like a
/// package that genuinely has one module.
#[test]
fn a_multi_module_package_recovers_its_whole_graph() {
    let root = fixture("graph");
    let modules = root.join("packages/app/node_modules");

    // Three modules, three maps, the way `tsc` emits them.
    write(
        &modules.join("split/package.json"),
        r#"{"name":"split","version":"1.0.0","main":"./dist/index.js"}"#,
    );
    for (name, source, body) in [
        (
            "index",
            "export { helper } from \"./helper.js\";\nexport { deep } from \"./nested/deep.js\";\n",
            "export const x=1;\n",
        ),
        ("helper", "export const helper = 1;\n", "export const h=1;\n"),
    ] {
        write(
            &modules.join(format!("split/dist/{name}.js")),
            &format!("{body}//# sourceMappingURL={name}.js.map\n"),
        );
        write(
            &modules.join(format!("split/dist/{name}.js.map")),
            &format!(
                r#"{{"version":3,"sources":["../src/{name}.ts"],"sourcesContent":[{}],"mappings":""}}"#,
                serde_json::to_string(source).unwrap()
            ),
        );
    }
    write(
        &modules.join("split/dist/nested/deep.js"),
        "export const d=1;\n//# sourceMappingURL=deep.js.map\n",
    );
    write(
        &modules.join("split/dist/nested/deep.js.map"),
        r#"{"version":3,"sources":["../../src/nested/deep.ts"],"sourcesContent":["export const deep = 1;\n"],"mappings":""}"#,
    );
    // Shipped, mapped, and imported by nobody.
    write(
        &modules.join("split/dist/orphan.js"),
        "export const o=1;\n//# sourceMappingURL=orphan.js.map\n",
    );
    write(
        &modules.join("split/dist/orphan.js.map"),
        r#"{"version":3,"sources":["../src/orphan.ts"],"sourcesContent":["export const orphan = 1;\n"],"mappings":""}"#,
    );
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"split":"1.0.0"}}"#,
    )
    .unwrap();

    acquire(&root);
    let vendor = root.join(".nts/vendor/split@1.0.0/src");
    assert!(vendor.join("index.ts").is_file(), "the entry");
    assert!(
        vendor.join("helper.ts").is_file(),
        "`./helper.js` names `helper.ts`, and its map is a different map"
    );
    assert!(
        vendor.join("nested/deep.ts").is_file(),
        "reached through the entry, from a map in another directory"
    );
    assert!(
        !vendor.join("orphan.ts").exists(),
        "shipped and mapped, but nothing imports it, so it is not in the program"
    );
}

/// Recovering files and recovering a *package* are different things, and a
/// partial recovery presented as a success is the one thing this must not do.
///
/// Measured: acquiring a 141-package corpus produced 3,091 typecheck errors and
/// 2,850 were one package importing `~/entity.ts` — a `paths` alias from a
/// tsconfig `drizzle-orm` does not publish. Vendoring that and calling it
/// acquired is worse than not acquiring it.
#[test]
fn source_that_cannot_build_is_refused_by_name() {
    let root = fixture("unbuildable");
    let modules = root.join("packages/app/node_modules");
    write(
        &modules.join("aliased/package.json"),
        r#"{"name":"aliased","version":"1.0.0","main":"./dist/index.js"}"#,
    );
    write(
        &modules.join("aliased/dist/index.js"),
        "export const x=1;\n//# sourceMappingURL=index.js.map\n",
    );
    write(
        &modules.join("aliased/dist/index.js.map"),
        r#"{"version":3,"sources":["../src/index.ts"],"sourcesContent":["import { e } from '~/entity.ts';\nexport const x = e;\n"],"mappings":""}"#,
    );
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"aliased":"1.0.0"}}"#,
    )
    .unwrap();

    let acquisition = acquire(&root);
    let aliased = acquisition
        .packages
        .iter()
        .find(|package| package.name == "aliased")
        .expect("in the closure");

    assert!(!aliased.acquired(), "it cannot be built, so it is not acquired");
    assert!(
        matches!(
            &aliased.route,
            nts_deps::recover::Route::SourceNeedsUnpublishedConfig { specifier }
                if specifier == "~/entity.ts"
        ),
        "and the refusal names what it could not find: {:?}",
        aliased.route
    );
    assert!(
        !root.join(".nts/vendor/aliased@1.0.0").exists(),
        "nothing unbuildable is left in the vendor tree"
    );
}

/// A node builtin and a real dependency are both fine to import.
#[test]
fn an_installed_dependency_and_a_builtin_are_not_unbuildable() {
    let root = fixture("buildable");
    let modules = root.join("packages/app/node_modules");
    write(
        &modules.join("uses-deps/package.json"),
        r#"{"name":"uses-deps","version":"1.0.0","main":"./dist/index.js","dependencies":{"mapped":"2.0.0"}}"#,
    );
    write(
        &modules.join("uses-deps/dist/index.js"),
        "export const x=1;\n//# sourceMappingURL=index.js.map\n",
    );
    write(
        &modules.join("uses-deps/dist/index.js.map"),
        r#"{"version":3,"sources":["../src/index.ts"],"sourcesContent":["import { x } from 'mapped';\nimport { join } from 'node:path';\nexport const y = [x, join];\n"],"mappings":""}"#,
    );
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"uses-deps":"1.0.0","mapped":"2.0.0"}}"#,
    )
    .unwrap();

    let acquisition = acquire(&root);
    let package = acquisition
        .packages
        .iter()
        .find(|package| package.name == "uses-deps")
        .expect("in the closure");
    assert!(package.acquired(), "route was {:?}", package.route);
}

/// A package that could not be acquired is remembered, and re-examining one is
/// most of what a no-op run used to cost: recovery indexes every source map a
/// package ships, and the packages with nothing to recover are the
/// overwhelming majority — 127 of 141 in the measured corpus.
///
/// The memo has to survive a round trip. It did not: the refusal was read back
/// and then not carried into the new lock, so every second run lost it and no
/// acquisition ever reported itself unchanged.
#[test]
fn a_refusal_is_remembered_across_runs() {
    let root = fixture("memo");
    let first = acquire(&root);
    let refused_first = first.packages.iter().filter(|p| !p.acquired()).count();
    assert!(refused_first > 0, "the fixture has packages with nothing to recover");

    let second = acquire(&root);
    assert!(second.unchanged, "a settled run has nothing to do");
    assert_eq!(
        second.packages.iter().filter(|p| !p.acquired()).count(),
        refused_first,
        "and still reports every refusal, from the lock rather than by re-examining"
    );
    for package in second.packages.iter().filter(|p| !p.acquired()) {
        assert!(
            !package.route.describe().is_empty(),
            "a remembered refusal still says why: {}",
            package.name
        );
    }

    // The third run reads a lock the second one wrote, which is the round trip
    // the second assertion above could not see.
    let third = acquire(&root);
    assert!(third.unchanged);
    assert_eq!(third.acquired(), first.acquired());
}

/// Deleting the vendor tree re-acquires, memo or not.
#[test]
fn a_missing_vendor_tree_is_recovered_again() {
    let root = fixture("vendor-gone");
    acquire(&root);
    let vendored = root.join(".nts/vendor/mapped@2.0.0");
    assert!(vendored.is_dir());

    std::fs::remove_dir_all(&vendored).unwrap();
    let after = acquire(&root);

    assert!(
        vendored.join("src/index.ts").is_file(),
        "the memo must not stand in for source that is no longer there"
    );
    assert!(after.packages.iter().any(|p| p.name == "mapped" && p.acquired()));
}

/// A settled run asks the checker once. It used to ask four times, walking the
/// fixpoint from scratch to rediscover a graph the lock already described — a
/// dependency's own dependencies are invisible until its source is in the
/// program, so every pass learned one layer that the previous run had already
/// learned and written down.
#[test]
fn a_settled_run_does_not_rewalk_the_fixpoint() {
    let root = fixture("seeded");
    let first = acquire(&root);
    assert!(first.files_written > 0);
    assert!(!first.unchanged, "a run that wrote files is not unchanged");

    let second = acquire(&root);
    assert!(second.unchanged);
    assert_eq!(
        second.acquired(),
        first.acquired(),
        "the seed reproduces the graph rather than shrinking it"
    );
}

/// And the seed must not hide a change. A newly imported package is acquired
/// on the next run, however settled the lock was.
#[test]
fn a_new_dependency_is_still_found_after_a_settled_run() {
    let root = fixture("seed-then-add");
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"shipped":"1.0.0"}}"#,
    )
    .unwrap();
    let settled = acquire(&root);
    assert!(acquire(&root).unchanged, "settled first");
    assert!(settled.packages.iter().all(|p| p.name != "mapped"));

    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"shipped":"1.0.0","mapped":"2.0.0"}}"#,
    )
    .unwrap();
    let after = acquire(&root);

    assert!(
        after.packages.iter().any(|p| p.name == "mapped" && p.acquired()),
        "a dependency added after the lock settled is still acquired"
    );
    assert!(!after.unchanged, "and the run says it did something");
    assert!(root.join(".nts/vendor/mapped@2.0.0/src/index.ts").is_file());
}

/// What the checker said about a package's recovered source has to survive a
/// settled run, which skips the pass that produces it.
///
/// This regressed the moment the fixpoint was seeded from the lock: a warm run
/// makes one checker pass, of the developer's *own* config, which never sees
/// vendored source. It had diagnostics — just none about packages — and taking
/// that as "no complaints" wiped what the lock had restored and reported every
/// acquired package as arriving clean, which is the opposite of what this
/// crate exists to say.
#[test]
fn what_a_package_needs_survives_a_settled_run() {
    let root = fixture("complaints");
    let modules = root.join("packages/app/node_modules");
    // Recovered source that reads an ambient its own build supplied.
    write(
        &modules.join("ambient/package.json"),
        r#"{"name":"ambient","version":"1.0.0","main":"./dist/index.js"}"#,
    );
    write(
        &modules.join("ambient/dist/index.js"),
        "export const x=1;\n//# sourceMappingURL=index.js.map\n",
    );
    write(
        &modules.join("ambient/dist/index.js.map"),
        r#"{"version":3,"sources":["../src/index.ts"],"sourcesContent":["export const x = process.env.NODE_ENV;\n"],"mappings":""}"#,
    );
    std::fs::write(
        root.join("packages/app/package.json"),
        r#"{"name":"@ws/app","version":"1.0.0","dependencies":{"ambient":"1.0.0"}}"#,
    )
    .unwrap();

    // Without tsgo there are no diagnostics at all, so this asserts the
    // *mechanism*: whatever a run records, the next run reproduces.
    let first = acquire(&root);
    let before: Vec<(String, Vec<String>)> = first
        .packages
        .iter()
        .map(|package| {
            (
                package.name.clone(),
                package.complaints.iter().map(|c| c.code.clone()).collect(),
            )
        })
        .collect();

    let second = acquire(&root);
    let after: Vec<(String, Vec<String>)> = second
        .packages
        .iter()
        .map(|package| {
            (
                package.name.clone(),
                package.complaints.iter().map(|c| c.code.clone()).collect(),
            )
        })
        .collect();

    assert_eq!(
        before, after,
        "a settled run reports what the first run found, not silence"
    );
}
