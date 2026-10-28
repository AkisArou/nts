//! Scope metadata identifies checked bindings, not a builtin implementation.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{
    PropertyKey, SCHEMA_VERSION, SemanticSnapshot, SymbolFlags, SymbolRecord,
};
use std::num::NonZeroU16;

struct Project(Utf8PathBuf);
impl Project {
    fn new(name: &str, main: &str) -> Self {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-global-bindings-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let project = Self(root.canonicalize_utf8().unwrap());
        project.write("main.ts", main);
        project.write("tsconfig.json", r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"commonjs","types":[],"noEmit":true},"include":["*.ts"]}"#);
        project
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.0.join(path), text).unwrap();
    }
    fn capture(&self) -> SemanticSnapshot {
        let snapshot = Frontend::new(&self.0)
            .with_checkers(NonZeroU16::MIN)
            .snapshot(&self.0.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        snapshot
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn symbols<'s>(snapshot: &'s SemanticSnapshot, name: &str) -> Vec<&'s SymbolRecord> {
    snapshot
        .symbols
        .iter()
        .filter(|symbol| symbol.name == PropertyKey::Name(name.into()))
        .collect()
}
fn only<'s>(snapshot: &'s SemanticSnapshot, name: &str) -> &'s SymbolRecord {
    let values = symbols(snapshot, name);
    assert_eq!(values.len(), 1, "{name}");
    values[0]
}
fn scope(symbol: &SymbolRecord) -> (bool, bool) {
    (
        symbol.flags.contains(SymbolFlags::GLOBAL_VALUE),
        symbol.flags.contains(SymbolFlags::GLOBAL_TYPE),
    )
}

#[test]
fn global_value_and_type_meanings_survive_the_snapshot_codec() {
    let project = Project::new(
        "meanings",
        "declare const valueOnly: number;\ninterface TypeOnly { value: number; }\ndeclare class Both { value: number; }\nfunction ordinary(valueOnly: number): number { return valueOnly; }\n",
    );
    let snapshot = project.capture();
    assert_eq!(scope(only(&snapshot, "TypeOnly")), (false, true));
    assert_eq!(scope(only(&snapshot, "Both")), (true, true));
    let values = symbols(&snapshot, "valueOnly");
    assert_eq!(values.len(), 2);
    assert_eq!(
        values
            .iter()
            .filter(|symbol| scope(symbol) == (true, false))
            .count(),
        1
    );
    assert_eq!(scope(only(&snapshot, "ordinary")), (true, false));
    assert!(only(&snapshot, "ordinary").library.is_none());
    assert!(
        !only(&snapshot, "ordinary").declarations.is_empty(),
        "global scope never erases its source body"
    );
    assert_eq!(snapshot.schema_version, SCHEMA_VERSION);
    let bytes = postcard::to_stdvec(&snapshot).unwrap();
    let decoded: SemanticSnapshot = postcard::from_bytes(&bytes).unwrap();
    decoded.validate().unwrap();
    assert_eq!(snapshot.digest().unwrap(), decoded.digest().unwrap());
}

#[test]
fn module_locals_named_like_library_roots_remain_local() {
    let project = Project::new(
        "shadow",
        "export class Array { constructor(readonly value: number) {} }\nexport interface Date { value: number; }\nexport const JSON = { parse(value: number): number { return value; } };\nexport function probe(): number { return new Array(JSON.parse(7)).value; }\n",
    );
    let snapshot = project.capture();
    for name in ["Array", "Date", "JSON"] {
        let declared: Vec<_> = symbols(&snapshot, name)
            .into_iter()
            .filter(|symbol| !symbol.declarations.is_empty())
            .collect();
        assert_eq!(declared.len(), 1, "{name}");
        assert_eq!(scope(declared[0]), (false, false), "{name}");
    }
}

#[test]
fn aliases_carry_their_scope_and_denote_the_actual_supplier() {
    let project = Project::new(
        "aliases",
        "import GlobalMath = require('./global');\nimport Math = require('./supplied');\nexport const result = GlobalMath.abs(-1) + Math.abs(-1);\n",
    );
    project.write("global.ts", "export = Math;\n");
    project.write(
        "supplied.ts",
        "const supplied = { abs(value: number): number { return value; } }; export = supplied;\n",
    );
    let snapshot = project.capture();
    let global = only(&snapshot, "GlobalMath");
    assert_eq!(scope(global), (false, false));
    let target = &snapshot.symbols[global.aliased.expect("actual supplier").0 as usize];
    assert!(scope(target).0);
    assert_eq!(target.library, Some(nts_semantic_schema::Library::Es));
    let local = symbols(&snapshot, "Math")
        .into_iter()
        .find(|symbol| symbol.aliased.is_some())
        .expect("the local alias, independently of the ambient supplier's same name");
    assert_eq!(scope(local), (false, false));
    assert_eq!(
        scope(&snapshot.symbols[local.aliased.unwrap().0 as usize]),
        (false, false)
    );
}

#[test]
fn merged_ambient_declarations_keep_every_site_and_only_their_real_meaning() {
    let project = Project::new(
        "merged",
        "interface Shared { second: string; }\nfunction read(value: Shared): number { return value.first + value.second.length; }\n",
    );
    project.write("ambient.d.ts", "interface Shared { first: number; }\n");
    let snapshot = project.capture();
    let merged = only(&snapshot, "Shared");
    assert_eq!(scope(merged), (false, true));
    assert_eq!(merged.declarations.len(), 2);
    assert_eq!(merged.declaration_sites.len(), 2);
    assert!(
        merged.library.is_none(),
        "merged scope facts do not invent an ambient-only implementation"
    );
}
