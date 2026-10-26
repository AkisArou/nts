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
    transform::{NodeTypes, REVISION_ROUNDS, TransformInput},
};

enum Action {
    Recheck(SourceChanges),
    Done(Box<SemanticSnapshot>),
}

enum Phase {
    Initial,
    Generated,
    Transform,
    Revisions,
    Capture,
}

struct Driver {
    phase: Phase,
    original_roots: Vec<String>,
    generated: Option<Vec<Utf8PathBuf>>,
    generation_rounds: usize,
    revision_rounds: usize,
    rewritten: Vec<Utf8PathBuf>,
    inclusion: Inclusion,
}

pub(super) fn inspect<R: Send, E: From<SnapshotError> + Send>(
    session: &mut Session,
    config: Utf8PathBuf,
    mut visitor: impl FnMut(&TransformInput<'_>, &NodeTypes<'_>) -> Result<R, E>,
) -> Result<Vec<R>, E> {
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
    // Capture and diagnostics use independent checkers. Only owned results
    // survive, as for the complete snapshot producer.
    let _finished = checked.finish();
    Ok(results)
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
    config: Utf8PathBuf,
) -> Result<SemanticSnapshot, SnapshotError> {
    let spec = ProjectSpec::new(config);
    let mut driver = Driver {
        phase: Phase::Initial,
        original_roots: Vec::new(),
        generated: None,
        generation_rounds: 0,
        revision_rounds: 0,
        rewritten: Vec::new(),
        inclusion: Inclusion::default(),
    };
    let mut changes = None;
    loop {
        // Cache observation groups will be collected here, with this revision's
        // spec. In particular the first physical reads precede all overlays.
        let action = {
            let checked = match changes.take() {
                None => session.open(spec.clone()),
                Some(changes) => session.revise(changes),
            }
            .map_err(|error| SnapshotError::Project(error.to_string()))?;
            driver.step(frontend, checked)?
        };
        match action {
            Action::Recheck(next) => changes = Some(next),
            Action::Done(snapshot) => return Ok(*snapshot),
        }
    }
}

impl Driver {
    fn step(
        &mut self,
        frontend: &mut Frontend,
        checked: Checked<'_>,
    ) -> Result<Action, SnapshotError> {
        if matches!(self.phase, Phase::Initial) {
            let project = checked.projects().next().ok_or_else(|| {
                SnapshotError::Project("the requested native program is missing".into())
            })?;
            self.original_roots = project.root_paths().map(ToString::to_string).collect();
            self.phase = Phase::Generated;
            if !frontend.added.is_empty() {
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
                    if let Some(changes) = self.generate(frontend, project)? {
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
                    if let Some(changes) = self.revise(frontend, project)? {
                        return Ok(Action::Recheck(changes));
                    }
                    self.phase = Phase::Capture;
                    return Ok(Action::Recheck(SourceChanges::default()));
                }
                Phase::Capture => {
                    let files = self.inclusion.files(project)?;
                    // Resolution uses the session's explicit cwd. Serialized
                    // source/module identities use the requested config's root,
                    // as the frontend's URI contract requires.
                    let cwd = project
                        .config_path()
                        .parent()
                        .ok_or_else(|| {
                            SnapshotError::Project(
                                "the requested config has no parent directory".into(),
                            )
                        })?
                        .to_owned();
                    let mut snapshot =
                        Capture::syntax(&cwd, files, project.semantics())?.finish()?;
                    let finished = checked.finish();
                    let project = finished.projects().next().ok_or_else(|| {
                        SnapshotError::Project("the requested native program is missing".into())
                    })?;
                    crate::capture::append_diagnostics(
                        &mut snapshot,
                        &cwd,
                        project,
                        finished.diagnostics(),
                    )?;
                    self.record_transform(frontend, &mut snapshot)?;
                    return Ok(Action::Done(Box::new(snapshot)));
                }
            }
        }
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
            roots: Some([frontend.added.as_slice(), files.as_slice()].concat()),
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
