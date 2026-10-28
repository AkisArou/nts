//! Revision decisions own their data. A checked view never crosses a revision.

use std::collections::BTreeMap;
use std::time::Duration;

use camino::Utf8PathBuf;
use nts_diagnostics::{Diagnostic, Location, Severity, SourceId, Span};
use nts_frontend_tsrs::{
    self as native, Checked, DiagnosticScope, DiagnosticsSelected, Project, ProjectSpec, Session,
    SourceChanges, SyntaxPhase,
};
use nts_semantic_schema::{SemanticSnapshot, SnapshotError};

use super::Frontend;
use crate::{
    FrontendStats,
    capture::Capture,
    generated::Complaint,
    inclusion::Inclusion,
    native_ast,
    planning::{CapturePlanner, PlannedSnapshot, RevisionInputs},
    transform::{NodeTypes, REVISION_ROUNDS, TransformInput},
};

enum Action<'s> {
    Recheck(SourceChanges),
    Ready(Checked<'s, DiagnosticsSelected>),
}

enum Completion<R> {
    Done(R),
    Recheck(SourceChanges),
}

struct Observations {
    spec: ProjectSpec,
    revisions: Vec<RevisionInputs>,
}

enum Phase {
    Initial,
    Generated,
    Transform,
    Revisions,
    Capture,
}

fn canonical_config(config: &camino::Utf8Path) -> Result<Utf8PathBuf, SnapshotError> {
    // Resolve symlinks before the checker's lexical path normalization sees `..`.
    config.canonicalize_utf8().map_err(|error| {
        SnapshotError::Project(format!("cannot resolve project config {config}: {error}"))
    })
}

struct Driver {
    project_root: Utf8PathBuf,
    phase: Phase,
    original_roots: Vec<String>,
    generated: Option<Vec<Utf8PathBuf>>,
    generation_rounds: usize,
    revision_rounds: usize,
    rewritten: Vec<Utf8PathBuf>,
    inclusion: Inclusion,
    planned_roots: Vec<Utf8PathBuf>,
    observations: Option<Observations>,
}

pub(super) fn inspect<R: Send, E: From<SnapshotError> + Send>(
    session: &mut Session,
    config: &camino::Utf8Path,
    mut visitor: impl FnMut(&TransformInput<'_>, &NodeTypes<'_>) -> Result<R, E>,
) -> Result<Vec<R>, E> {
    let config = canonical_config(config).map_err(E::from)?;
    let checked = session
        .open(ProjectSpec::new(config))
        .map_err(|error| E::from(SnapshotError::Project(error.to_string())))?;
    let mut inclusion = Inclusion::default();
    let checked = select_diagnostics(checked, &mut inclusion).map_err(E::from)?;
    let project = checked.projects().next().ok_or_else(|| {
        E::from(SnapshotError::Project(
            "the requested native program is missing".into(),
        ))
    })?;
    let results = inspect_files(project, &mut inclusion, &mut visitor)?;
    // Capture and diagnostics use independent checkers. Only owned results
    // survive, as for the complete snapshot producer.
    let _finished = checked.finish();
    Ok(results)
}

fn inspect_files<R, E: From<SnapshotError>>(
    project: Project<'_>,
    inclusion: &mut Inclusion,
    visitor: &mut impl FnMut(&TransformInput<'_>, &NodeTypes<'_>) -> Result<R, E>,
) -> Result<Vec<R>, E> {
    let mut results = Vec::new();
    for file in inclusion.files(project)? {
        let captured = native_ast::capture(file, SourceId(0))?;
        let types = NodeTypes::new(&captured.native_nodes);
        results.push(visitor(
            &TransformInput {
                path: file.path(),
                text: file.text(),
                tree: &captured.tree,
            },
            &types,
        )?);
    }
    Ok(results)
}

/// Inspect precisely the world obtained after the capture driver's existing
/// generation, added-root, transform and revision stages have settled.
/// No complete semantic graph or lowering is performed for this inspection.
pub(super) fn inspect_sources<R, E: From<SnapshotError>>(
    frontend: &mut Frontend,
    session: &mut Session,
    config: &camino::Utf8Path,
    mut visitor: impl FnMut(&TransformInput<'_>, &NodeTypes<'_>) -> Result<R, E>,
) -> Result<Vec<R>, E> {
    run_sources(frontend, session, config, false, |driver, _, checked| {
        let project = checked.projects().next().ok_or_else(|| {
            E::from(SnapshotError::Project(
                "the requested native program is missing".into(),
            ))
        })?;
        let results = inspect_files(project, &mut driver.inclusion, &mut visitor)?;
        let _finished = checked.finish();
        Ok(Completion::Done(results))
    })
}

/// Choose the exact source boundary before any semantic transform/capture work.
/// Owning paths here releases all views before the typestate transition.
fn select_diagnostics<'s>(
    checked: Checked<'s>,
    inclusion: &mut Inclusion,
) -> Result<Checked<'s, DiagnosticsSelected>, SnapshotError> {
    let project = checked
        .projects()
        .next()
        .ok_or_else(|| SnapshotError::Project("the requested native program is missing".into()))?;
    let paths: Vec<_> = inclusion
        .files(project)?
        .into_iter()
        .map(|file| file.path().to_owned())
        .collect();
    Ok(checked.start_diagnostics(DiagnosticScope::Files(&paths)))
}

pub(super) fn capture(
    frontend: &mut Frontend,
    session: &mut Session,
    config: &camino::Utf8Path,
) -> Result<SemanticSnapshot, SnapshotError> {
    run_sources(
        frontend,
        session,
        config,
        false,
        |driver, frontend, checked| driver.snapshot(frontend, checked).map(Completion::Done),
    )
}

pub(super) fn capture_with_plan<P: CapturePlanner>(
    frontend: &mut Frontend,
    session: &mut Session,
    config: &camino::Utf8Path,
    planner: &mut P,
) -> Result<PlannedSnapshot<P::Plan>, P::Error> {
    let session_identity = session.cache_identity();
    let mut selected = None;
    run_sources(
        frontend,
        session,
        config,
        true,
        |driver, frontend, checked| {
            let project = checked.projects().next().ok_or_else(|| {
                SnapshotError::Project("the requested native program is missing".into())
            })?;
            let files = driver.inclusion.files(project)?;
            let capture = Capture::syntax(&driver.project_root, files, project.semantics())?;
            let plan = if let Some(plan) = selected.take() {
                planner.verify(&capture.world(), &plan)?;
                plan
            } else {
                let decision = planner.plan(&capture.world())?;
                let mut roots = Vec::with_capacity(decision.source_roots.len());
                for path in decision.source_roots {
                    if !path.is_absolute() {
                        return Err(SnapshotError::Project(format!(
                            "a planned source root must be absolute: {path}"
                        ))
                        .into());
                    }
                    roots.push(path.canonicalize_utf8().map_err(|error| {
                        SnapshotError::Project(format!(
                            "cannot resolve planned source {path}: {error}"
                        ))
                    })?);
                }
                roots.sort_unstable();
                roots.dedup();
                // Existing decoded sources need no revision and introduce no new
                // semantic world. A file merely loaded as an excluded library is
                // deliberately not enough to take this path.
                let all_present = crate::planning::roots_present(
                    &roots,
                    capture
                        .world()
                        .sources()
                        .iter()
                        .map(|source| source.display_path.as_path()),
                );
                if !all_present {
                    let existing_sources = capture
                        .world()
                        .sources()
                        .iter()
                        .map(|source| source.display_path.clone())
                        .collect();
                    drop(capture);
                    let finished = checked.finish();
                    driver.record_inputs(|| finished.inputs());
                    selected = Some(decision.plan);
                    return Ok(Completion::Recheck(driver.plan_roots(
                        frontend,
                        roots,
                        existing_sources,
                    )));
                }
                decision.plan
            };
            let snapshot = capture.finish()?;
            let snapshot = driver.finish_snapshot(frontend, checked, snapshot)?;
            let inputs = driver
                .observations
                .take()
                .map_or_else(Vec::new, |state| state.revisions);
            Ok(Completion::Done(PlannedSnapshot {
                snapshot,
                plan,
                inputs,
                session_identity: session_identity.clone(),
            }))
        },
    )
}

fn run_sources<R, E: From<SnapshotError>>(
    frontend: &mut Frontend,
    session: &mut Session,
    config: &camino::Utf8Path,
    observe: bool,
    mut ready: impl for<'s> FnMut(
        &mut Driver,
        &mut Frontend,
        Checked<'s, DiagnosticsSelected>,
    ) -> Result<Completion<R>, E>,
) -> Result<R, E> {
    let config = canonical_config(config)?;
    let project_root = config
        .parent()
        .ok_or_else(|| {
            SnapshotError::Project("the requested config has no parent directory".into())
        })?
        .to_owned();
    let spec = ProjectSpec::new(config);
    let mut driver = Driver {
        project_root,
        phase: Phase::Initial,
        original_roots: Vec::new(),
        generated: None,
        generation_rounds: 0,
        revision_rounds: 0,
        rewritten: Vec::new(),
        inclusion: Inclusion::default(),
        planned_roots: Vec::new(),
        observations: observe.then(|| Observations {
            spec: spec.clone(),
            revisions: Vec::new(),
        }),
    };
    let mut changes = None;
    loop {
        // Cache observation groups will be collected here, with this revision's
        // spec. In particular the first physical reads precede all overlays.
        let action = {
            let checked = match changes.take() {
                None => session.open(spec.clone()),
                Some(changes) => {
                    driver.apply_spec(&changes);
                    session.revise(changes)
                }
            }
            .map_err(|error| SnapshotError::Project(error.to_string()))?;
            driver.prepare(frontend, checked)?
        };
        match action {
            Action::Recheck(next) => changes = Some(next),
            Action::Ready(checked) => match ready(&mut driver, frontend, checked)? {
                Completion::Done(result) => return Ok(result),
                Completion::Recheck(next) => changes = Some(next),
            },
        }
    }
}

impl Driver {
    fn apply_spec(&mut self, changes: &SourceChanges) {
        if let Some(observations) = &mut self.observations {
            for (path, text) in &changes.overlays {
                if let Some(text) = text {
                    observations
                        .spec
                        .overlays
                        .insert(path.clone(), text.clone());
                } else {
                    observations.spec.overlays.remove(path);
                }
            }
            if let Some(roots) = &changes.roots {
                observations.spec.roots.clone_from(roots);
            }
        }
    }

    fn record_inputs(&mut self, inputs: impl FnOnce() -> Vec<native::Input>) {
        if let Some(observations) = &mut self.observations {
            observations.revisions.push(RevisionInputs {
                spec: observations.spec.clone(),
                inputs: inputs(),
            });
        }
    }

    fn plan_roots(
        &mut self,
        frontend: &Frontend,
        roots: Vec<Utf8PathBuf>,
        existing_sources: Vec<Utf8PathBuf>,
    ) -> SourceChanges {
        self.planned_roots = roots;
        self.inclusion
            .allow_sources(&self.planned_roots, existing_sources);
        // SourceTransform is deterministic, not idempotent. Re-run its source
        // stages on physical/generated inputs, never on its own prior output.
        let overlays = self.rewritten.drain(..).map(|path| (path, None)).collect();
        self.phase = Phase::Generated;
        self.generation_rounds = 0;
        self.revision_rounds = 0;
        SourceChanges {
            roots: Some(
                [
                    frontend.added.as_slice(),
                    self.planned_roots.as_slice(),
                    self.generated.as_deref().unwrap_or_default(),
                ]
                .concat(),
            ),
            overlays,
        }
    }

    fn prepare<'s>(
        &mut self,
        frontend: &mut Frontend,
        checked: Checked<'s>,
    ) -> Result<Action<'s>, SnapshotError> {
        if matches!(self.phase, Phase::Initial) {
            let project = checked.projects().next().ok_or_else(|| {
                SnapshotError::Project("the requested native program is missing".into())
            })?;
            self.original_roots = project.root_paths().map(ToString::to_string).collect();
            self.phase = Phase::Generated;
            if !frontend.added.is_empty() {
                self.record_inputs(|| checked.inputs());
                return Ok(Action::Recheck(SourceChanges {
                    roots: Some(frontend.added.clone()),
                    ..SourceChanges::default()
                }));
            }
        }
        let checked = select_diagnostics(checked, &mut self.inclusion)?;
        loop {
            let project = checked.projects().next().ok_or_else(|| {
                SnapshotError::Project("the requested native program is missing".into())
            })?;
            match self.phase {
                Phase::Initial => unreachable!("initial roots are recorded before selection"),
                Phase::Generated => {
                    let active = match frontend.generated.as_deref() {
                        None => false,
                        Some(generated) if self.generation_rounds == 0 => {
                            match generated.import_prefixes() {
                                Some(prefixes) => self.imports_match(project, prefixes)?,
                                None => true,
                            }
                        }
                        Some(_) => true,
                    };
                    if !active {
                        self.phase = Phase::Transform;
                        continue;
                    }
                    let finished = checked.finish();
                    let project = finished.projects().next().ok_or_else(|| {
                        SnapshotError::Project("the requested native program is missing".into())
                    })?;
                    let changes = self.generate(frontend, project)?;
                    self.record_inputs(|| finished.inputs());
                    if let Some(changes) = changes {
                        return Ok(Action::Recheck(changes));
                    }
                    self.phase = Phase::Transform;
                    // Generation consumed diagnostics. Subsequent semantic
                    // capture needs a fresh designated checker, even if the
                    // generator had no new roots this round.
                    return Ok(Action::Recheck(SourceChanges::default()));
                }
                Phase::Transform => {
                    self.phase = Phase::Revisions;
                    if let Some(changes) = self.transform(frontend, project)? {
                        self.record_inputs(|| checked.inputs());
                        return Ok(Action::Recheck(changes));
                    }
                }
                Phase::Revisions => {
                    if frontend.transform.is_none() {
                        self.phase = Phase::Capture;
                        continue;
                    }
                    let finished = checked.finish();
                    let project = finished.projects().next().ok_or_else(|| {
                        SnapshotError::Project("the requested native program is missing".into())
                    })?;
                    let changes = self.revise(frontend, project)?;
                    self.record_inputs(|| finished.inputs());
                    if let Some(changes) = changes {
                        return Ok(Action::Recheck(changes));
                    }
                    self.phase = Phase::Capture;
                    return Ok(Action::Recheck(SourceChanges::default()));
                }
                Phase::Capture => return Ok(Action::Ready(checked)),
            }
        }
    }

    fn snapshot(
        &mut self,
        frontend: &mut Frontend,
        checked: Checked<'_, DiagnosticsSelected>,
    ) -> Result<SemanticSnapshot, SnapshotError> {
        let project = checked.projects().next().ok_or_else(|| {
            SnapshotError::Project("the requested native program is missing".into())
        })?;
        let files = self.inclusion.files(project)?;
        // Resolution uses the session's explicit cwd. Serialized
        // source/module identities use the requested config's root,
        // as the frontend's URI contract requires.
        let snapshot = Capture::syntax(&self.project_root, files, project.semantics())?.finish()?;
        self.finish_snapshot(frontend, checked, snapshot)
    }

    fn finish_snapshot(
        &mut self,
        frontend: &Frontend,
        checked: Checked<'_, DiagnosticsSelected>,
        mut snapshot: SemanticSnapshot,
    ) -> Result<SemanticSnapshot, SnapshotError> {
        let finished = checked.finish();
        let project = finished.projects().next().ok_or_else(|| {
            SnapshotError::Project("the requested native program is missing".into())
        })?;
        crate::capture::append_diagnostics(
            &mut snapshot,
            &self.project_root,
            project,
            finished.diagnostics(),
        )?;
        self.record_transform(frontend, &mut snapshot)?;
        self.record_inputs(|| finished.inputs());
        Ok(snapshot)
    }

    fn generate(
        &mut self,
        frontend: &mut Frontend,
        project: Project<'_, SyntaxPhase>,
    ) -> Result<Option<SourceChanges>, SnapshotError> {
        let Some(generated) = frontend.generated.as_deref_mut() else {
            return Ok(None);
        };
        let roots: Vec<_> = project.root_paths().collect();
        let complaints: Vec<_> = project
            .diagnostics()
            .into_iter()
            .filter(|diagnostic| {
                diagnostic
                    .path
                    .as_deref()
                    .is_some_and(|path| roots.contains(&path))
            })
            .map(|diagnostic| Complaint {
                code: diagnostic.code,
                text: diagnostic.message,
            })
            .collect();
        let Some(files) = generated
            .files(project.config_path(), &self.original_roots, &complaints)
            .map_err(SnapshotError::Project)?
        else {
            return Ok(None);
        };
        if self.generated.as_ref() == Some(&files) {
            return Ok(None);
        }
        if self.generation_rounds >= 4 {
            return Err(SnapshotError::Project(
                "generated sources did not settle after four rounds".into(),
            ));
        }
        self.generation_rounds += 1;
        self.generated = Some(files.clone());
        Ok(Some(SourceChanges {
            roots: Some(
                [
                    frontend.added.as_slice(),
                    self.planned_roots.as_slice(),
                    files.as_slice(),
                ]
                .concat(),
            ),
            ..SourceChanges::default()
        }))
    }

    fn imports_match(
        &mut self,
        project: Project<'_>,
        prefixes: &[&str],
    ) -> Result<bool, SnapshotError> {
        for file in self.inclusion.files(project)? {
            for imported in file.imports() {
                let imported = imported.utf8().ok_or_else(|| SnapshotError::Project(format!("a module specifier in {} contains unpaired UTF-16 code units and cannot name a filesystem module", file.path())))?;
                if prefixes.iter().any(|prefix| imported.starts_with(prefix)) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn transform(
        &mut self,
        frontend: &mut Frontend,
        project: Project<'_>,
    ) -> Result<Option<SourceChanges>, SnapshotError> {
        let Some(transform) = frontend.transform.as_deref_mut() else {
            return Ok(None);
        };
        let mut overlays = BTreeMap::new();
        for file in self.inclusion.files(project)? {
            let captured = native_ast::capture(file, SourceId(0))?;
            let types = NodeTypes::new(&captured.native_nodes);
            if let Some(text) = transform.transform(
                &TransformInput {
                    path: file.path(),
                    text: file.text(),
                    tree: &captured.tree,
                },
                &types,
            ) && text != file.text()
            {
                self.rewritten.push(file.path().to_owned());
                overlays.insert(file.path().to_owned(), Some(text));
            }
        }
        Ok((!overlays.is_empty()).then_some(SourceChanges {
            overlays,
            roots: None,
        }))
    }

    fn revise(
        &mut self,
        frontend: &mut Frontend,
        project: Project<'_, SyntaxPhase>,
    ) -> Result<Option<SourceChanges>, SnapshotError> {
        let Some(transform) = frontend.transform.as_deref_mut() else {
            return Ok(None);
        };
        let diagnostics = project.diagnostics();
        let mut overlays = BTreeMap::new();
        for path in &self.rewritten {
            let errors: Vec<_> = diagnostics
                .iter()
                .filter(|diagnostic| {
                    diagnostic.category == native::DiagnosticCategory::Error
                        && diagnostic.path.as_deref() == Some(path)
                })
                .filter_map(|diagnostic| diagnostic.span.map(|span| (span.start.0, span.end.0)))
                .collect();
            if errors.is_empty() {
                continue;
            }
            if let Some(text) = transform.revise(path, &errors)
                && project
                    .files()
                    .find(|file| file.path() == path)
                    .is_some_and(|file| file.text() != text)
            {
                overlays.insert(path.clone(), Some(text));
            }
        }
        if overlays.is_empty() {
            return Ok(None);
        }
        if self.revision_rounds >= REVISION_ROUNDS {
            return Err(SnapshotError::Project(format!(
                "{} was still revising after {REVISION_ROUNDS} rounds (the cap)",
                transform.identity()
            )));
        }
        self.revision_rounds += 1;
        Ok(Some(SourceChanges {
            overlays,
            roots: None,
        }))
    }

    fn record_transform(
        &self,
        frontend: &Frontend,
        snapshot: &mut SemanticSnapshot,
    ) -> Result<(), SnapshotError> {
        let Some(transform) = frontend.transform.as_deref() else {
            return Ok(());
        };
        for (index, source) in snapshot.sources.iter_mut().enumerate() {
            if self.rewritten.contains(&source.display_path) {
                source.rewritten_by = Some(transform.identity());
                source.rewritten_map = transform.position_map(&source.display_path);
            }
            let file = SourceId(
                u32::try_from(index)
                    .map_err(|_| SnapshotError::Project("too many diagnostic sources".into()))?,
            );
            for reported in transform.diagnostics(&source.display_path) {
                snapshot.diagnostics.push(Diagnostic {
                    severity: reported.severity,
                    code: reported.code.into(),
                    message: reported.message,
                    primary: Location {
                        file,
                        span: Span::new(0, 0),
                    },
                    labels: Vec::new(),
                });
            }
        }
        Ok(())
    }
}

pub(super) fn stats(snapshot: &SemanticSnapshot, elapsed: Duration) -> FrontendStats {
    let count = |value| u32::try_from(value).unwrap_or(u32::MAX);
    FrontendStats {
        elapsed_ms: elapsed.as_millis().try_into().unwrap_or(u64::MAX),
        files: count(snapshot.sources.len()),
        nodes_captured: count(snapshot.nodes.len()),
        types_resolved: count(snapshot.node_types.len()),
        distinct_types: count(snapshot.types.len()),
        errors: count(
            snapshot
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == Severity::Error)
                .count(),
        ),
        warnings: count(
            snapshot
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == Severity::Warning)
                .count(),
        ),
        symbols: count(snapshot.symbols.len()),
        modules: count(snapshot.modules.len()),
        calls_resolved: count(snapshot.call_targets.len()),
        constants_folded: count(snapshot.constants.len()),
        decomposition_exhausted: snapshot
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS0003"),
    }
}
