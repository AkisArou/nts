//! Ordinary file-set composition must match fresh ordinary per-file checking.

use std::collections::BTreeSet;
use std::num::NonZeroU16;
use std::sync::Mutex;

use super::*;
use crate::run;

fn options(count: u16) -> SessionOptions {
    let mut options = SessionOptions::new("/__nts_diagnostic_scope_test__");
    options.checker_count = NonZeroU16::new(count);
    options
}

fn spec(settings: &str, source: &str, js: bool) -> ProjectSpec {
    let mut spec = ProjectSpec::new("tsconfig.json");
    let name = if js { "main.js" } else { "main.ts" };
    spec.overlays.insert("tsconfig.json".into(), format!(r#"{{"compilerOptions":{{"strict":true,"target":"ESNext","types":[]{settings}}},"files":["{name}"]}}"#));
    spec.overlays.insert(name.into(), source.to_owned());
    spec
}

fn kept_paths(checked: &Checked<'_>) -> Vec<Utf8PathBuf> {
    checked
        .projects()
        .flat_map(Project::files)
        .filter(|file| !file.is_default_library())
        .map(|file| file.path().to_owned())
        .collect()
}

// A fresh program for each arm: equivalence cannot depend on warm caches.
fn answers(options: SessionOptions, spec: ProjectSpec, composed: bool) -> Vec<Diagnostic> {
    answer_result(options, spec, composed).expect("diagnostic project")
}

fn answer_result(
    options: SessionOptions,
    spec: ProjectSpec,
    composed: bool,
) -> Result<Vec<Diagnostic>, String> {
    run(options, |session| {
        let checked = session.open(spec).map_err(|error| error.to_string())?;
        let paths = kept_paths(&checked);
        if composed {
            return Ok(checked
                .start_diagnostics(DiagnosticScope::Files(&paths))
                .finish()
                .diagnostics());
        }
        let owner = checked.owner;
        let _scope = owner.region.enter();
        let ctx = Context::default();
        let mut native = owner.config_diagnostics.clone();
        for project in &owner.projects {
            let program = project.program;
            native.extend(program.get_config_file_parsing_diagnostics());
            native.extend(program.get_program_diagnostics());
            for file in &project.files {
                if !program.is_source_file_default_library(file.source.path()) {
                    native.extend(program.get_syntactic_diagnostics(&ctx, Some(file.source)));
                    native.extend(program.get_semantic_diagnostics(&ctx, Some(file.source)));
                }
            }
            native.extend(program.get_global_diagnostics(&ctx));
        }
        let mut diagnostics: Vec<_> = native.into_iter().map(|d| owner.diagnostic(d)).collect();
        diagnostics.extend(crate::environment::initialize().notes());
        diagnostics.sort();
        diagnostics.dedup();
        Ok(diagnostics)
    })
}

fn equivalent(spec: ProjectSpec, count: u16) -> Vec<Diagnostic> {
    let composed = answers(options(count), spec.clone(), true);
    assert_eq!(composed, answers(options(count), spec, false));
    composed
}

#[test]
fn composed_file_set_preserves_ordinary_filters_and_global_errors() {
    for count in [1, 4] {
        let ignored = equivalent(
            spec("", "// @ts-ignore\nconst x: number = 'wrong';", false),
            count,
        );
        assert!(ignored.is_empty(), "{ignored:?}");
        let unused = equivalent(
            spec("", "// @ts-expect-error\nconst x: number = 1;", false),
            count,
        );
        assert_eq!(unused.iter().map(|d| d.code).collect::<Vec<_>>(), [2578]);
        let bad_reference = equivalent(
            spec(
                "",
                "/// <reference path='./absent.d.ts' />\nexport {};",
                false,
            ),
            count,
        );
        assert!(
            bad_reference.iter().any(|d| d.code == 6053),
            "{bad_reference:?}"
        );
        let global = equivalent(spec(",\"noLib\":true", "export {};", false), count);
        assert!(
            global.iter().any(|d| d.code == 2318 && d.path.is_none()),
            "{global:?}"
        );
        for no_emit in [false, true] {
            let settings = format!(",\"module\":\"CommonJS\",\"noEmit\":{no_emit}");
            let diagnostics =
                equivalent(spec(&settings, "export const require = 1;", false), count);
            // Both declared settings are checked as tsc --noEmit: nts owns
            // emission, so a generated CommonJS name is not a source error.
            assert!(diagnostics.is_empty(), "{diagnostics:?}");
        }
        for settings in [
            ",\"allowJs\":true,\"noEmit\":true",
            ",\"allowJs\":true,\"checkJs\":false,\"noEmit\":true",
            ",\"allowJs\":true,\"checkJs\":true,\"noEmit\":true",
        ] {
            let diagnostics = equivalent(spec(settings, "const x = 0n === 1n;", true), count);
            assert_eq!(
                diagnostics.iter().any(|d| d.code == 2367),
                settings.contains("\"checkJs\":true"),
                "{diagnostics:?}"
            );
        }
    }
}

// Read the native checkers' completed-file flags, rather than counting the
// caller's requested paths or filtering diagnostics after checking libraries.
fn checked_files(project: Project<'_, SyntaxPhase>) -> Vec<(usize, Utf8PathBuf)> {
    let files = Mutex::new(Vec::new());
    let sources: Vec<_> = project
        .native
        .files
        .iter()
        .map(|file| {
            (
                file.source,
                crate::host::native_path(file.source.file_name()).to_owned(),
            )
        })
        .collect();
    project
        .native
        .program
        .for_each_checker_parallel(|index, checker| {
            for (source, path) in &sources {
                if checker.is_source_file_type_checked_exported(*source) {
                    files
                        .lock()
                        .expect("checked files")
                        .push((index, path.clone()));
                }
            }
        });
    files.into_inner().expect("checked files")
}

#[test]
fn selected_files_never_check_default_libraries_but_program_scope_does() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session
                .open(spec("", "const wrong: number = 'wrong';", false))
                .expect("project");
            let paths = kept_paths(&checked);
            let finished = checked
                .start_diagnostics(DiagnosticScope::Files(&paths))
                .finish();
            assert_eq!(
                finished
                    .diagnostics()
                    .iter()
                    .map(|d| d.code)
                    .collect::<Vec<_>>(),
                [2322]
            );
            let project = finished.projects().next().expect("program");
            let visited = checked_files(project);
            assert_eq!(visited.len(), 1, "{visited:?}");
            assert_eq!(visited[0].1, paths[0]);
            assert!(
                project
                    .files()
                    .filter(|file| file.is_default_library())
                    .count()
                    > 50
            );
            let checked = session
                .open(spec("", "const wrong: number = 'wrong';", false))
                .expect("program control");
            let finished = checked.start_diagnostics(DiagnosticScope::Program).finish();
            let project = finished.projects().next().expect("program");
            assert!(checked_files(project).len() > 50);
        });
    }
}

#[test]
fn selected_files_use_the_native_diagnostic_pool() {
    run(options(4), |session| {
        let mut spec = spec(",\"noLib\":true", "export const value = 1;", false);
        for index in 0..12 {
            let path = Utf8PathBuf::from(format!("part{index}.ts"));
            spec.overlays.insert(
                path.clone(),
                format!("export const value{index}: number = {index};"),
            );
            spec.roots.push(path);
        }
        let checked = session.open(spec).expect("multi-file project");
        let paths = kept_paths(&checked);
        let finished = checked
            .start_diagnostics(DiagnosticScope::Files(&paths))
            .finish();
        let project = finished.projects().next().expect("program");
        assert_eq!(project.native.program.checker_count(), 3);
        let visited = checked_files(project);
        assert_eq!(visited.len(), paths.len());
        assert!(
            visited
                .iter()
                .map(|(index, _)| *index)
                .collect::<BTreeSet<_>>()
                .len()
                > 1,
            "{visited:?}"
        );
        assert_eq!(
            visited
                .iter()
                .map(|(_, path)| path)
                .collect::<BTreeSet<_>>(),
            paths.iter().collect()
        );
    });
}

#[test]
#[ignore = "one-off audit; NTS_SCOPE_CONFIGS is a newline-separated absolute config list"]
fn composed_matches_plain_for_corpus_and_interop_configs() {
    use std::io::Write as _;
    let list = std::env::var("NTS_SCOPE_CONFIGS").expect("explicit config list");
    let configs = std::fs::read_to_string(list).expect("read config list");
    let evidence = std::env::var("NTS_SCOPE_EVIDENCE").expect("explicit evidence path");
    let mut evidence = std::fs::File::create(evidence).expect("create evidence");
    for (index, path) in configs.lines().enumerate() {
        let path = Utf8Path::new(path);
        let mut options = SessionOptions::new(path.parent().expect("config parent").to_owned());
        options.checker_count = NonZeroU16::new(4);
        let project = ProjectSpec::new(path.to_owned());
        let composed = answer_result(options.clone(), project.clone(), true);
        let plain = answer_result(options, project, false);
        assert_eq!(composed, plain, "config {path}");
        writeln!(
            evidence,
            "{}\t{:?}\tidentical",
            path,
            composed.as_ref().map(Vec::len)
        )
        .expect("evidence row");
        evidence.flush().expect("flush progress");
        eprintln!("scope equivalence {}: {path}", index + 1);
    }
}

#[test]
fn bad_reference_control_exercises_the_public_include_processor_step() {
    run(options(1), |session| {
        let checked = session
            .open(spec(
                "",
                "/// <reference path='./absent.d.ts' />\nexport {};",
                false,
            ))
            .expect("reference control");
        let program = checked.owner.projects[0].program;
        let file = program
            .get_source_file("/__nts_diagnostic_scope_test__/main.ts")
            .expect("source");
        let diagnostics = program.get_include_processor_diagnostics(file);
        assert!(
            diagnostics.iter().any(|d| d.code() == 6053),
            "include processor codes: {:?}",
            diagnostics.iter().map(|d| d.code()).collect::<Vec<_>>()
        );
    });
}
