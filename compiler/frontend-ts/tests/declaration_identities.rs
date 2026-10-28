//! Inspection facts own their provenance; final capture supplies fresh IDs.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::{Frontend, transform::NodeReferences};
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, SnapshotError, syntax};
use std::num::NonZeroU16;

struct Project {
    root: Utf8PathBuf,
}

impl Project {
    fn new(name: &str, main: &str) -> Self {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "nts-declaration-identities-{}-{name}",
                std::process::id()
            ));
        std::fs::create_dir_all(&root).unwrap();
        let this = Self {
            root: root.canonicalize_utf8().unwrap(),
        };
        this.write("main.ts", main);
        this.write(
            "base.d.ts",
            "declare function choose(value: unknown): number;\n",
        );
        this.config("tsconfig.json", &["main.ts", "base.d.ts"]);
        this
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.root.join(path), text).unwrap();
    }
    fn config(&self, name: &str, files: &[&str]) {
        self.write(name, &serde_json::json!({"compilerOptions":{"strict":true,"noEmit":true,"target":"es2022","module":"esnext","types":[]},"files":files}).to_string());
    }
    fn frontend(&self) -> Frontend {
        Frontend::new(&self.root).with_checkers(NonZeroU16::MIN)
    }
    fn snapshot(&self, name: &str) -> SemanticSnapshot {
        let snapshot = self.frontend().snapshot(&self.root.join(name)).unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        snapshot
    }
    fn calls(&self) -> Vec<NodeReferences> {
        self.frontend()
            .inspect(&self.root.join("tsconfig.json"), |file, types| {
                let mut calls = Vec::new();
                if file.path.file_name() == Some("main.ts") {
                    for (i, node) in file.tree.nodes.iter().enumerate() {
                        if node.kind == NodeKind::Syntax(syntax::CALL_EXPRESSION) {
                            calls.push(
                                types
                                    .references_at(NodeId(u32::try_from(i).unwrap()))?
                                    .unwrap(),
                            );
                        }
                    }
                }
                Ok::<_, SnapshotError>(calls)
            })
            .unwrap()
            .into_iter()
            .flatten()
            .collect()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

const MAIN: &str = "// 😀 UTF-16 provenance\nexport function probe() { return choose('x'); }\n";

#[test]
fn inspection_rebinds_into_a_fresh_capture_with_utf16_coordinates() {
    let project = Project::new("fresh", MAIN);
    let calls = project.calls();
    let [call] = calls.as_slice() else {
        panic!("one inspected call: {calls:?}")
    };
    assert_eq!(
        call.site.span.start,
        u32::try_from(
            MAIN[..MAIN.find("choose('x')").unwrap()]
                .encode_utf16()
                .count()
        )
        .unwrap()
    );
    let snapshot = project.snapshot("tsconfig.json");
    let index = snapshot.declaration_index().unwrap();
    let node = index.find(&call.site).unwrap().expect("fresh call node");
    let selected = snapshot.call_targets[&node].declaration.unwrap();
    assert_eq!(
        snapshot.declaration_identity(selected),
        call.selected_overload
    );
    assert!(
        index
            .find(call.selected_overload.as_ref().unwrap())
            .unwrap()
            .is_some()
    );
}

#[test]
fn identical_offsets_under_another_checked_project_do_not_rebind() {
    let project = Project::new("context", MAIN);
    let old = project.calls().remove(0);
    project.config("other.json", &["main.ts", "base.d.ts"]);
    let snapshot = project.snapshot("other.json");
    assert!(
        snapshot
            .declaration_index()
            .unwrap()
            .find(&old.site)
            .unwrap()
            .is_none()
    );
}

#[test]
fn same_span_and_kind_after_a_source_edit_do_not_rebind() {
    let project = Project::new("content", MAIN);
    let old = project.calls().remove(0);
    project.write("main.ts", &MAIN.replace("'x'", "'y'"));
    let snapshot = project.snapshot("tsconfig.json");
    assert!(
        snapshot
            .declaration_index()
            .unwrap()
            .find(&old.site)
            .unwrap()
            .is_none()
    );
}

#[test]
fn added_ambient_roots_preserve_the_locator_but_change_the_selected_overload() {
    let project = Project::new("merge", MAIN);
    let old = project.calls().remove(0);
    project.write(
        "extra.d.ts",
        "declare function choose(value: string): string;\n",
    );
    let final_snapshot = project
        .frontend()
        .with_added(&[project.root.join("extra.d.ts")])
        .snapshot(&project.root.join("tsconfig.json"))
        .unwrap();
    assert!(
        !final_snapshot.has_errors(),
        "{:?}",
        final_snapshot.diagnostics
    );
    let index = final_snapshot.declaration_index().unwrap();
    let call = index
        .find(&old.site)
        .unwrap()
        .expect("unchanged use syntax");
    let selected = final_snapshot
        .declaration_identity(final_snapshot.call_targets[&call].declaration.unwrap())
        .unwrap();
    assert_ne!(
        Some(&selected),
        old.selected_overload.as_ref(),
        "an unchanged anchor is not semantic equivalence"
    );
    assert!(selected.source.path.ends_with("extra.d.ts"));
    let choose = final_snapshot
        .symbols
        .iter()
        .find(|symbol| symbol.name.is_name("choose") && symbol.declaration_sites.len() == 2)
        .unwrap();
    assert_eq!(
        choose.declaration_sites.len(),
        2,
        "the complete merged supplier set is retained"
    );

    // The inspection session has ended. A direct full capture of precisely the
    // final closure must produce the same owned snapshot as inspect + capture.
    project.config("tsconfig.json", &["main.ts", "base.d.ts", "extra.d.ts"]);
    let direct = project.snapshot("tsconfig.json");
    assert_eq!(final_snapshot.digest().unwrap(), direct.digest().unwrap());
}

#[test]
fn library_call_overloads_keep_anchors_without_inventing_captured_nodes() {
    let project = Project::new(
        "library",
        "export function probe() { return Math.abs(-1); }\n",
    );
    let inspected = project.calls().remove(0);
    let snapshot = project.snapshot("tsconfig.json");
    let index = snapshot.declaration_index().unwrap();
    let call = index.find(&inspected.site).unwrap().unwrap();
    let target = snapshot.call_targets[&call];
    assert!(target.callee.is_none());
    let declaration = snapshot
        .declaration_identity(target.declaration.unwrap())
        .unwrap();
    assert_eq!(Some(&declaration), inspected.selected_overload.as_ref());
    assert!(
        index.find(&declaration).unwrap().is_none(),
        "library syntax was not captured"
    );
    let math = snapshot
        .symbols
        .iter()
        .find(|s| s.name.is_name("Math") && s.library.is_some())
        .unwrap();
    assert!(
        !math.declaration_sites.is_empty(),
        "external declarations have owned identities"
    );
}

#[test]
fn inspection_follows_reexport_aliases_to_the_actual_supplier() {
    let project = Project::new(
        "aliases",
        "import { renamed } from './alias'; export function probe() { return renamed(2); }\n",
    );
    project.write(
        "supplier.ts",
        "export function original(value: number) { return value + 1; }\n",
    );
    project.write(
        "alias.ts",
        "export { original as renamed } from './supplier';\n",
    );
    let facts = project
        .frontend()
        .inspect(&project.root.join("tsconfig.json"), |file, types| {
            let mut facts = Vec::new();
            if file.path.file_name() == Some("main.ts") {
                for (i, node) in file.tree.nodes.iter().enumerate() {
                    if node.kind == NodeKind::Syntax(syntax::IDENTIFIER)
                        && node
                            .text
                            .as_ref()
                            .and_then(nts_semantic_schema::JsText::as_utf8)
                            == Some("renamed")
                    {
                        facts.push(
                            types
                                .references_at(NodeId(u32::try_from(i).unwrap()))?
                                .unwrap(),
                        );
                    }
                }
            }
            Ok::<_, SnapshotError>(facts)
        })
        .unwrap();
    assert!(facts.iter().flatten().any(|fact| {
        fact.declarations
            .iter()
            .any(|decl| decl.source.path.ends_with("supplier.ts"))
    }));
    let snapshot = project.snapshot("tsconfig.json");
    let index = snapshot.declaration_index().unwrap();
    let selected = project.calls().remove(0).selected_overload.unwrap();
    assert!(selected.source.path.ends_with("supplier.ts"));
    assert!(index.find(&selected).unwrap().is_some());
}

#[test]
fn declaration_tables_validate_and_participate_in_the_snapshot_digest() {
    let project = Project::new("validation", MAIN);
    let snapshot = project.snapshot("tsconfig.json");
    snapshot.validate().unwrap();
    let digest = snapshot.digest().unwrap();
    let call = *snapshot.call_targets.keys().next().unwrap();
    let mut changed = snapshot.clone();
    changed.call_targets.get_mut(&call).unwrap().declaration = None;
    assert_ne!(digest, changed.digest().unwrap());
    let mut changed = snapshot.clone();
    changed.declaration_sources[0].project = "/another/project.json".into();
    assert_ne!(digest, changed.digest().unwrap());

    for invalid in [
        nts_semantic_schema::DeclarationSite {
            source: nts_semantic_schema::DeclarationSourceId(u32::MAX),
            span: nts_diagnostics::Span::new(0, 1),
            kind: syntax::IDENTIFIER,
        },
        nts_semantic_schema::DeclarationSite {
            source: nts_semantic_schema::DeclarationSourceId(0),
            span: nts_diagnostics::Span::new(2, 1),
            kind: syntax::IDENTIFIER,
        },
        nts_semantic_schema::DeclarationSite {
            source: nts_semantic_schema::DeclarationSourceId(0),
            span: nts_diagnostics::Span::new(0, u32::MAX),
            kind: syntax::IDENTIFIER,
        },
        nts_semantic_schema::DeclarationSite {
            source: nts_semantic_schema::DeclarationSourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
            kind: u16::MAX,
        },
    ] {
        let mut changed = snapshot.clone();
        changed.call_targets.get_mut(&call).unwrap().declaration = Some(invalid);
        assert!(changed.validate().is_err(), "{invalid:?}");
    }
    let mut changed = snapshot.clone();
    changed
        .declaration_sources
        .push(changed.declaration_sources[0].clone());
    assert!(changed.validate().is_err(), "duplicate context");
    let mut changed = snapshot.clone();
    changed.declaration_sources[0].digest = nts_diagnostics::Digest([0; 16]);
    assert!(
        changed.validate().is_err(),
        "captured source identity disagreement"
    );
    let encoded = postcard::to_allocvec(&snapshot).unwrap();
    let decoded: SemanticSnapshot = postcard::from_bytes(&encoded).unwrap();
    assert_eq!(decoded.digest().unwrap(), digest);
    decoded.validate().unwrap();
}

#[test]
fn swapped_call_target_declarations_do_not_validate() {
    let project = Project::new("swapped-call", MAIN);
    let snapshot = project.snapshot("tsconfig.json");
    let call = *snapshot.call_targets.keys().next().unwrap();
    let selected = snapshot.call_targets[&call].declaration.unwrap();
    let other = snapshot
        .symbols
        .iter()
        .find(|s| s.name.is_name("probe"))
        .unwrap()
        .declaration_sites[0];
    assert_ne!(selected, other);

    let mut changed = snapshot.clone();
    changed.call_targets.get_mut(&call).unwrap().declaration = Some(other);
    assert!(
        changed.validate().is_err(),
        "two individually valid declarations were swapped at the call"
    );
}

#[test]
fn swapped_symbol_declarations_do_not_validate() {
    let project = Project::new("swapped-symbol", MAIN);
    let snapshot = project.snapshot("tsconfig.json");
    let call = *snapshot.call_targets.keys().next().unwrap();
    let selected = snapshot.call_targets[&call].declaration.unwrap();
    let other = snapshot
        .symbols
        .iter()
        .find(|s| s.name.is_name("probe"))
        .unwrap()
        .declaration_sites[0];
    assert_ne!(selected, other);
    let mut changed = snapshot.clone();
    let symbol = changed
        .symbols
        .iter_mut()
        .find(|s| s.name.is_name("choose") && s.declaration_sites.contains(&selected))
        .unwrap();
    assert!(
        symbol
            .declarations
            .contains(&snapshot.call_targets[&call].callee.unwrap())
    );
    symbol.declaration_sites = vec![other];
    assert!(
        changed.validate().is_err(),
        "two individually valid declarations were swapped at the symbol"
    );
}
