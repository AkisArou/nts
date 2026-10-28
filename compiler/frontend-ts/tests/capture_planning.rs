//! Planning keeps one checked session and at most one provider-root revision.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::num::NonZeroU16;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{
    Frontend,
    generated::{Complaint, Generated},
    planning::{CapturePlanner, Planned, SourceWorld},
    transform::{NodeTypes, SourceTransform, TransformInput},
};
use nts_semantic_schema::{DeclarationIdentity, NodeId, SnapshotError, syntax};

struct Project(Utf8PathBuf);

impl Project {
    fn new(name: &str, main: &str) -> Self {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "nts-capture-planning-{}-{name}",
                std::process::id()
            ));
        std::fs::create_dir_all(&root).unwrap();
        let project = Self(root.canonicalize_utf8().unwrap());
        project.write("main.ts", main);
        project.write("tsconfig.json", r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]},"files":["main.ts"]}"#);
        project
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    fn config(&self) -> Utf8PathBuf {
        self.0.join("tsconfig.json")
    }
    fn frontend(&self) -> Frontend {
        Frontend::new(&self.0).with_checkers(NonZeroU16::MIN)
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[derive(Default)]
struct Counts {
    plan: usize,
    verify: usize,
    threads: Vec<std::thread::ThreadId>,
}

struct Planner {
    roots: Vec<Utf8PathBuf>,
    counts: Arc<Mutex<Counts>>,
    keep_calls: bool,
    selected: Option<Arc<AtomicBool>>,
}

fn anchors(
    world: &SourceWorld<'_>,
    calls: bool,
) -> Result<Vec<DeclarationIdentity>, SnapshotError> {
    let mut result = Vec::new();
    for (index, node) in world.nodes().iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap());
        if calls && node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::CALL_EXPRESSION) {
            if let Some(target) = world
                .types()
                .references_at(id)?
                .and_then(|value| value.selected_overload)
            {
                result.push(target);
            }
        } else if !calls && node.parent.is_none() {
            result.push(world.types().identity_at(id)?.unwrap());
        }
    }
    result.sort();
    Ok(result)
}

impl CapturePlanner for Planner {
    type Plan = Vec<DeclarationIdentity>;
    type Error = SnapshotError;
    fn plan(&mut self, world: &SourceWorld<'_>) -> Result<Planned<Self::Plan>, Self::Error> {
        let mut counts = self.counts.lock().unwrap();
        counts.plan += 1;
        counts.threads.push(std::thread::current().id());
        if let Some(selected) = &self.selected {
            selected.store(true, Ordering::Release);
        }
        Ok(Planned {
            plan: anchors(world, self.keep_calls)?,
            source_roots: self.roots.clone(),
        })
    }
    fn verify(&mut self, world: &SourceWorld<'_>, plan: &Self::Plan) -> Result<(), Self::Error> {
        let mut counts = self.counts.lock().unwrap();
        counts.verify += 1;
        counts.threads.push(std::thread::current().id());
        if self.keep_calls && anchors(world, true)? != *plan {
            return Err(SnapshotError::Project(
                "final supplier/overload closure changed".into(),
            ));
        }
        Ok(())
    }
}

fn planner(roots: Vec<Utf8PathBuf>) -> Planner {
    Planner {
        roots,
        counts: Arc::default(),
        keep_calls: false,
        selected: None,
    }
}

#[test]
fn no_new_roots_finish_the_same_capture_and_keep_owned_anchors() {
    let project = Project::new("same", "export function answer(): number { return 42; }\n");
    let mut plan = planner(Vec::new());
    let captured = project
        .frontend()
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap();
    let direct = project.frontend().snapshot(&project.config()).unwrap();
    assert_eq!(
        captured.snapshot.digest().unwrap(),
        direct.digest().unwrap()
    );
    assert_eq!(captured.inputs.len(), 1, "no additional checked revision");
    let counts = plan.counts.lock().unwrap();
    assert_eq!((counts.plan, counts.verify), (1, 0));
    assert_ne!(counts.threads[0], std::thread::current().id());
    let index = captured.snapshot.declaration_index().unwrap();
    for identity in captured.plan {
        assert!(index.find(&identity).unwrap().is_some());
    }
}

#[test]
fn an_already_decoded_source_needs_no_provider_revision() {
    let project = Project::new(
        "present",
        "import { value } from './value'; export const result = value;\n",
    );
    project.write("value.ts", "export const value = 42;\n");
    let mut plan = planner(vec![project.0.join("value.ts")]);
    let captured = project
        .frontend()
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap();
    assert_eq!(captured.inputs.len(), 1);
    assert_eq!(plan.counts.lock().unwrap().verify, 0);
}

#[test]
fn added_roots_verify_once_on_the_same_thread_and_match_direct_capture() {
    let project = Project::new("added", "export const result = 42;\n");
    project.write(
        "implementation.ts",
        "export function implementation(): number { return 7; }\n",
    );
    let roots = vec![project.0.join("implementation.ts")];
    let mut plan = planner(roots.clone());
    let captured = project
        .frontend()
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap();
    let direct = project
        .frontend()
        .with_added(&roots)
        .snapshot(&project.config())
        .unwrap();
    assert_eq!(
        captured.snapshot.digest().unwrap(),
        direct.digest().unwrap()
    );
    assert_eq!(captured.inputs.len(), 2);
    let counts = plan.counts.lock().unwrap();
    assert_eq!((counts.plan, counts.verify), (1, 1));
    assert_eq!(counts.threads[0], counts.threads[1]);
}

#[derive(Debug)]
struct NonIdempotent;

impl SourceTransform for NonIdempotent {
    fn identity(&self) -> String {
        "planning-non-idempotent/1".into()
    }
    fn transform(&mut self, file: &TransformInput<'_>, _: &NodeTypes<'_>) -> Option<String> {
        (file.path.file_name() == Some("main.ts"))
            .then(|| file.text.replace("= 2", "= 3").replace("= 1", "= 2"))
    }
    fn revise(&mut self, _: &Utf8Path, _: &[(u32, u32)]) -> Option<String> {
        None
    }
}

#[test]
fn source_revision_restarts_transforms_from_original_inputs_and_keeps_replay_groups() {
    let project = Project::new("transform", "export const result = 1;\n");
    project.write("implementation.ts", "export const implementation = 9;\n");
    let roots = vec![project.0.join("implementation.ts")];
    let mut plan = planner(roots.clone());
    let captured = project
        .frontend()
        .with_transform(Box::new(NonIdempotent))
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap();
    let direct = project
        .frontend()
        .with_transform(Box::new(NonIdempotent))
        .with_added(&roots)
        .snapshot(&project.config())
        .unwrap();
    assert_eq!(
        captured.snapshot.digest().unwrap(),
        direct.digest().unwrap()
    );
    assert!(
        captured.inputs.len() > 2,
        "retain physical and transformed revision groups"
    );
    let options = {
        let mut options = nts_frontend_tsrs::SessionOptions::new(&project.0);
        options.checker_count = Some(NonZeroU16::MIN);
        options
    };
    nts_frontend_tsrs::run(options.clone(), |session| {
        assert_eq!(session.cache_identity(), captured.session_identity);
        for group in &captured.inputs {
            session.inputs_match(&group.spec, &group.inputs).unwrap();
        }
    });
    project.write("main.ts", "export const result = 99;\n");
    nts_frontend_tsrs::run(options, |session| {
        assert!(
            session
                .inputs_match(&captured.inputs[0].spec, &captured.inputs[0].inputs)
                .is_err(),
            "a final overlay cannot hide a changed physical source"
        );
    });
}

#[derive(Debug)]
struct Surface {
    before: Utf8PathBuf,
    after: Utf8PathBuf,
    selected: Arc<AtomicBool>,
}
impl Generated for Surface {
    fn identity(&self) -> String {
        "planning-generated/1".into()
    }
    fn files(
        &mut self,
        _: &Utf8Path,
        _: &[String],
        _: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        Ok(Some(vec![if self.selected.load(Ordering::Acquire) {
            self.after.clone()
        } else {
            self.before.clone()
        }]))
    }
}

#[test]
fn generator_updates_keep_original_explicit_and_planned_roots() {
    let project = Project::new(
        "generated",
        "export const result = generatedValue + explicitValue;\n",
    );
    project.write(
        "generated-before.d.ts",
        "declare const generatedValue: number;\n",
    );
    project.write(
        "generated-after.d.ts",
        "declare const generatedValue: number;\n",
    );
    project.write("explicit.d.ts", "declare const explicitValue: number;\n");
    project.write("implementation.ts", "export const implementation = 9;\n");
    let explicit = project.0.join("explicit.d.ts");
    let implementation = project.0.join("implementation.ts");
    let selected = Arc::new(AtomicBool::new(false));
    let frontend = || {
        project.frontend().with_generated(Box::new(Surface {
            before: project.0.join("generated-before.d.ts"),
            after: project.0.join("generated-after.d.ts"),
            selected: Arc::clone(&selected),
        }))
    };
    let mut plan = planner(vec![implementation.clone()]);
    plan.selected = Some(Arc::clone(&selected));
    let captured = frontend()
        .with_added(std::slice::from_ref(&explicit))
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap();
    let direct = frontend()
        .with_added(&[explicit, implementation])
        .snapshot(&project.config())
        .unwrap();
    assert!(
        !captured.snapshot.has_errors(),
        "{:?}",
        captured.snapshot.diagnostics
    );
    assert_eq!(
        captured.snapshot.digest().unwrap(),
        direct.digest().unwrap()
    );
    assert_eq!(captured.snapshot.sources.len(), 4);
    let paths: std::collections::BTreeSet<_> = captured
        .snapshot
        .sources
        .iter()
        .map(|source| source.display_path.file_name().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            "main.ts",
            "explicit.d.ts",
            "implementation.ts",
            "generated-after.d.ts"
        ]
        .into_iter()
        .collect()
    );
}

#[test]
fn an_added_ambient_overload_invalidates_the_selected_plan_without_replanning() {
    let project = Project::new(
        "overload",
        "declare function choose(value: number): number; export const result = choose(1);\n",
    );
    project.write(
        "overload.d.ts",
        "declare function choose(value: 1): string;\n",
    );
    // Global declarations must share the ambient namespace with main's use.
    project.write("main.ts", "const result = choose(1);\n");
    project.write(
        "base.d.ts",
        "declare function choose(value: number): number;\n",
    );
    let mut plan = planner(vec![project.0.join("overload.d.ts")]);
    plan.keep_calls = true;
    let error = project
        .frontend()
        .with_added(&[project.0.join("base.d.ts")])
        .snapshot_with_plan(&project.config(), &mut plan)
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("final supplier/overload closure changed")
    );
    let counts = plan.counts.lock().unwrap();
    assert_eq!((counts.plan, counts.verify), (1, 1));
}

#[test]
fn external_source_packages_admit_exactly_the_recorded_closure() {
    let project = Project::new("package", "export const result = 42;\n");
    project.write(
        "node_modules/proved/package.json",
        r#"{"name":"proved","type":"module"}"#,
    );
    project.write(
        "node_modules/proved/index.ts",
        "import { helper } from './helper'; export const implementation = helper;\n",
    );
    project.write(
        "node_modules/proved/helper.ts",
        "export const helper = 9;\n",
    );
    let entry = project.0.join("node_modules/proved/index.ts");
    let helper = project.0.join("node_modules/proved/helper.ts");
    let mut incomplete = planner(vec![entry.clone()]);
    let error = project
        .frontend()
        .snapshot_with_plan(&project.config(), &mut incomplete)
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("outside its recorded implementation closure"),
        "{error}"
    );
    let mut complete = planner(vec![entry, helper]);
    let captured = project
        .frontend()
        .snapshot_with_plan(&project.config(), &mut complete)
        .unwrap();
    assert!(
        !captured.snapshot.has_errors(),
        "{:?}",
        captured.snapshot.diagnostics
    );
    assert_eq!(captured.snapshot.sources.len(), 3);
}
