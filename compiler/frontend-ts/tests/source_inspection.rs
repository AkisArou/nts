//! Provider inspection must see the settled sources that full capture sees.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{
    Frontend,
    generated::{Complaint, Generated},
    transform::{NodeTypes, SourceTransform, TransformInput},
};
use nts_semantic_schema::{DeclarationIdentity, NodeId, SnapshotError};
use std::num::NonZeroU16;

struct Project {
    root: Utf8PathBuf,
}

impl Project {
    fn new(name: &str, main: &str) -> Self {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "nts-source-inspection-{}-{name}",
                std::process::id()
            ));
        std::fs::create_dir_all(&root).unwrap();
        let this = Self {
            root: root.canonicalize_utf8().unwrap(),
        };
        this.write("main.ts", main);
        this.write("tsconfig.json", r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","noEmit":true,"types":[]},"files":["main.ts"]}"#);
        this
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.root.join(path), text).unwrap();
    }
    fn frontend(&self) -> Frontend {
        Frontend::new(&self.root).with_checkers(NonZeroU16::MIN)
    }
    fn config(&self) -> Utf8PathBuf {
        self.root.join("tsconfig.json")
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[derive(Debug)]
struct Rewrite {
    back_off: bool,
    original: Option<String>,
}

impl SourceTransform for Rewrite {
    fn identity(&self) -> String {
        format!("inspection-rewrite/1/{}", self.back_off)
    }
    fn transform(&mut self, file: &TransformInput<'_>, _: &NodeTypes<'_>) -> Option<String> {
        if file.path.file_name() != Some("main.ts") {
            return None;
        }
        self.original = Some(file.text.to_owned());
        Some(file.text.replace(
            "return 1",
            if self.back_off {
                "return 'wrong'"
            } else {
                "return 2"
            },
        ))
    }
    fn revise(&mut self, _: &Utf8Path, errors: &[(u32, u32)]) -> Option<String> {
        if self.back_off && !errors.is_empty() {
            self.original.take()
        } else {
            None
        }
    }
}

fn rewrite(back_off: bool) -> Box<dyn SourceTransform> {
    Box::new(Rewrite {
        back_off,
        original: None,
    })
}

fn root_identity(
    file: &TransformInput<'_>,
    types: &NodeTypes<'_>,
) -> Result<(String, DeclarationIdentity), SnapshotError> {
    Ok((file.text.to_owned(), types.identity_at(NodeId(0))?.unwrap()))
}

#[test]
fn settled_inspection_and_capture_share_the_actual_transformed_world() {
    let project = Project::new(
        "transform",
        "export function probe(): number { return 1; }\n",
    );
    let mut frontend = project.frontend().with_transform(rewrite(false));
    let bare = frontend.inspect(&project.config(), root_identity).unwrap();
    assert!(
        bare[0].0.contains("return 1"),
        "standalone transform tooling keeps its original-input contract"
    );
    let settled = frontend
        .inspect_sources(&project.config(), root_identity)
        .unwrap();
    assert!(settled[0].0.contains("return 2"));
    assert_ne!(bare[0].1.source.digest, settled[0].1.source.digest);
    let snapshot = frontend.snapshot(&project.config()).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    assert!(
        snapshot
            .declaration_index()
            .unwrap()
            .find(&settled[0].1)
            .unwrap()
            .is_some()
    );
    let direct = project
        .frontend()
        .with_transform(rewrite(false))
        .snapshot(&project.config())
        .unwrap();
    assert_eq!(snapshot.digest().unwrap(), direct.digest().unwrap());
}

#[test]
fn settled_inspection_waits_for_source_revision_backoff() {
    let project = Project::new(
        "revision",
        "export function probe(): number { return 1; }\n",
    );
    let settled = project
        .frontend()
        .with_transform(rewrite(true))
        .inspect_sources(&project.config(), root_identity)
        .unwrap();
    assert!(settled[0].0.contains("return 1"));
    assert!(
        !settled[0].0.contains("wrong"),
        "a rejected transform is not the inspected world"
    );
    let snapshot = project
        .frontend()
        .with_transform(rewrite(true))
        .snapshot(&project.config())
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    assert!(
        snapshot
            .declaration_index()
            .unwrap()
            .find(&settled[0].1)
            .unwrap()
            .is_some()
    );
}

#[derive(Debug)]
struct Surface {
    file: Utf8PathBuf,
}

impl Generated for Surface {
    fn identity(&self) -> String {
        "inspection-surface/1".into()
    }
    fn files(
        &mut self,
        _: &Utf8Path,
        _: &[String],
        _: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        Ok(Some(vec![self.file.clone()]))
    }
}

#[test]
fn settled_inspection_keeps_original_generated_and_explicit_roots() {
    let project = Project::new(
        "roots",
        "export function probe(): number { return generatedValue() + addedValue; }\n",
    );
    project.write(
        "generated.d.ts",
        "declare function generatedValue(): number;\n",
    );
    project.write("added.d.ts", "declare const addedValue: number;\n");
    let mut frontend = project
        .frontend()
        .with_added(&[project.root.join("added.d.ts")])
        .with_generated(Box::new(Surface {
            file: project.root.join("generated.d.ts"),
        }));
    let inspected = frontend
        .inspect_sources(&project.config(), |file, types| {
            Ok::<_, SnapshotError>((file.path.to_owned(), types.identity_at(NodeId(0))?.unwrap()))
        })
        .unwrap();
    let names: std::collections::BTreeSet<_> = inspected
        .iter()
        .map(|(path, _)| path.file_name().unwrap())
        .collect();
    assert_eq!(
        names,
        ["added.d.ts", "generated.d.ts", "main.ts"]
            .into_iter()
            .collect()
    );
    let snapshot = frontend.snapshot(&project.config()).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let index = snapshot.declaration_index().unwrap();
    for (_, identity) in &inspected {
        assert!(index.find(identity).unwrap().is_some());
    }
}
