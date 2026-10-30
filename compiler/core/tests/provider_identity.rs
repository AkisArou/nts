//! Provider identity is a checked scope/provenance fact, never a spelling.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8PathBuf;
use nts_core::hir::{
    self,
    features::{GlobalMeaning, global_binding},
};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{Library, NodeId, PropertyKey, SemanticSnapshot, SymbolFlags, SymbolId};
use std::num::NonZeroU16;

struct Project(Utf8PathBuf);
impl Project {
    fn new(name: &str, source: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "nts-provider-identity-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let root = Utf8PathBuf::from_path_buf(path)
            .unwrap()
            .canonicalize_utf8()
            .unwrap();
        std::fs::write(root.join("main.ts"), source).unwrap();
        std::fs::write(root.join("tsconfig.json"),r#"{"compilerOptions":{"strict":true,"target":"ESNext","lib":["ESNext","DOM"],"types":[]},"files":["main.ts"]}"#).unwrap();
        Self(root)
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
fn symbol(snapshot: &SemanticSnapshot, name: &str, library: Option<&Library>) -> SymbolId {
    let index = snapshot
        .symbols
        .iter()
        .position(|s| s.name == PropertyKey::Name(name.into()) && s.library.as_ref() == library)
        .unwrap();
    SymbolId(u32::try_from(index).unwrap())
}
fn date_snapshot(name: &str) -> SemanticSnapshot {
    Project::new(name,"export function builtin(): number { return new Date(1).getTime(); }\nexport function shadow(Date: () => number): number { return Date(); }\nexport function annotation(value: Date): Date { return value; }\n").capture()
}

#[test]
fn checked_global_meanings_and_source_owned_decoys_stay_distinct() {
    let snapshot = date_snapshot("scope");
    let date = symbol(&snapshot, "Date", Some(&Library::Es));
    let value = global_binding(&snapshot.symbols, date, GlobalMeaning::Value)
        .unwrap()
        .unwrap();
    assert_eq!(value.name(), "Date");
    assert_eq!(value.library(), &Library::Es);
    assert_eq!(value.symbol(), date);
    assert!(value.compiler_provided());
    assert!(
        global_binding(&snapshot.symbols, date, GlobalMeaning::Type)
            .unwrap()
            .is_some()
    );
    let local = symbol(&snapshot, "Date", None);
    assert!(
        global_binding(&snapshot.symbols, local, GlobalMeaning::Value)
            .unwrap()
            .is_none()
    );
    assert!(
        global_binding(&snapshot.symbols, local, GlobalMeaning::Type)
            .unwrap()
            .is_none()
    );
}

#[test]
fn checked_alias_identity_survives_renaming_and_cycles_fail_closed() {
    let mut snapshot = date_snapshot("aliases");
    let date = symbol(&snapshot, "Date", Some(&Library::Es));
    let alias = SymbolId(u32::try_from(snapshot.symbols.len()).unwrap());
    let mut record = snapshot.symbols[date.0 as usize].clone();
    record.name = PropertyKey::Name("a_different_written_name".into());
    record.flags = SymbolFlags::default();
    record.library = None;
    record.aliased = Some(date);
    snapshot.symbols.push(record);
    assert_eq!(
        global_binding(&snapshot.symbols, alias, GlobalMeaning::Value)
            .unwrap()
            .unwrap()
            .symbol(),
        date
    );
    snapshot.symbols[alias.0 as usize].aliased = Some(alias);
    assert!(
        global_binding(&snapshot.symbols, alias, GlobalMeaning::Value)
            .unwrap_err()
            .to_string()
            .contains("cyclic")
    );
    assert!(global_binding(&snapshot.symbols, SymbolId(u32::MAX), GlobalMeaning::Value).is_err());
}

#[test]
fn both_scope_and_declaration_provenance_are_required() {
    let snapshot = date_snapshot("provenance");
    let date = symbol(&snapshot, "Date", Some(&Library::Es));
    let mut symbols = snapshot.symbols.clone();
    symbols[date.0 as usize].flags = SymbolFlags::GLOBAL_TYPE;
    assert!(
        global_binding(&symbols, date, GlobalMeaning::Value)
            .unwrap()
            .is_none()
    );
    assert!(
        global_binding(&symbols, date, GlobalMeaning::Type)
            .unwrap()
            .is_some()
    );
    symbols[date.0 as usize] = snapshot.symbols[date.0 as usize].clone();
    symbols[date.0 as usize].library = Some(Library::Package("a-decoy-package".into()));
    assert!(
        !global_binding(&symbols, date, GlobalMeaning::Value)
            .unwrap()
            .unwrap()
            .compiler_provided()
    );
    symbols[date.0 as usize] = snapshot.symbols[date.0 as usize].clone();
    symbols[date.0 as usize].library = None;
    assert!(
        global_binding(&symbols, date, GlobalMeaning::Value)
            .unwrap()
            .is_none()
    );
    symbols[date.0 as usize] = snapshot.symbols[date.0 as usize].clone();
    symbols[date.0 as usize].declarations.push(NodeId(0));
    assert!(global_binding(&symbols, date, GlobalMeaning::Value).is_err());
    symbols[date.0 as usize] = snapshot.symbols[date.0 as usize].clone();
    symbols[date.0 as usize].declaration_sites.clear();
    assert!(global_binding(&symbols, date, GlobalMeaning::Value).is_err());
}

#[test]
fn an_unprovided_constructor_needs_a_candidate_before_lowering() {
    let project = Project::new(
        "missing",
        "export function missing(): void { const value = new WeakMap<object, number>(); }\n",
    );
    let snapshot = project.capture();
    let weak = symbol(&snapshot, "WeakMap", Some(&Library::Es));
    assert!(
        !global_binding(&snapshot.symbols, weak, GlobalMeaning::Value)
            .unwrap()
            .unwrap()
            .compiler_provided()
    );
}

#[test]
fn a_source_class_with_a_library_name_keeps_its_implementation() {
    let project = Project::new(
        "own-class",
        "export class URL { constructor(public value: number) {} }\nexport function own(): number { return new URL(7).value; }\n",
    );
    let snapshot = project.capture();
    let local = symbol(&snapshot, "URL", None);
    assert!(
        global_binding(&snapshot.symbols, local, GlobalMeaning::Value)
            .unwrap()
            .is_none()
    );
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.program.refused_bodies().next().is_none(),
        "{:?}",
        prepared.program.uncompiled
    );
    assert!(
        !prepared.diagnostics.iter().any(|d| d.code == "NTS1100"),
        "{:?}",
        prepared.diagnostics
    );
}
