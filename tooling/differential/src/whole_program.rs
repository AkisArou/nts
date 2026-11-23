//! A program with no exported workload is compared whole.
//!
//! The per-call harness compares a program's answers inside its case windows,
//! so a source with nothing to call -- a launch row's `case.ts`, or any
//! `tests/programs` entry whose exports no case can drive -- compared nothing.
//! Here it runs once under the pinned node and once on the backend, and the
//! two must print the same stdout, byte for byte, and end with the same exit
//! status. Stderr is not compared: an uncaught throw is reported in each
//! side's own words, and the exit status is what both promise.
//!
//! # Which program runs
//!
//! The compiled side is the harness's own build, the same one every per-call
//! check runs: the program, its runtime and the deterministic host, with a
//! `main` that evaluates the module and drains its loop. It is not the
//! executable `nts build` ships, whose `main` installs the libuv host. Virtual
//! time and one thread keep the comparison reproducible, and the constructs a
//! deterministic host could not run faithfully -- a clock, `process.exit`, a
//! native binding with its own completions -- are refused by name here or by
//! lowering before anything runs. The shipped `main` is held to node by each
//! launch row's own checksum agreement (`tooling/bench/README.md`).
//!
//! # How it ends
//!
//! An uncaught throw ends both sides with status 1 (`nts_uncaught`), and that
//! is an answer like any other. A signal is not: the compiled side crashing is
//! an abort, and a refusal it reports before stopping is a decline, which
//! compares nothing. A run past the compiled-call allowance is a recorded
//! timeout ([`call_activity`](super::call_activity)), never a hang.

use anyhow::{Context as _, Result, bail, ensure};
use camino::Utf8Path;
use nts_codegen_common::Backend;
use nts_core::hir;
use serde_json::Value;

use super::check_report::{self, FailureKind, annotate, with_failure};
use super::{
    PreparedCheck, Report, Stopped, call_activity, case_costs, lines, oracle_coverage, oracle_emit,
    output_disagreements, signal_of, stopped_with,
};

/// What a fixture's `program` row promises node prints and how it ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Recorded {
    pub(super) stdout_sha256: String,
    pub(super) stdout_bytes: usize,
    pub(super) exit_code: i32,
}

/// What node answered for a whole program.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Answer {
    pub(super) stdout: Vec<u8>,
    pub(super) exit_code: i32,
}

impl Answer {
    pub(super) fn digest(&self) -> String {
        oracle_emit::digest(&self.stdout)
    }

    /// Whether this is the answer `recorded` promises.
    fn matches(&self, recorded: &Recorded) -> bool {
        self.exit_code == recorded.exit_code
            && self.stdout.len() == recorded.stdout_bytes
            && self.digest() == recorded.stdout_sha256
    }
}

/// How the compiled program's one run ended.
#[derive(Debug)]
pub(super) enum Native {
    /// It ran to its end, or ended itself, with this status.
    Exited { stdout: Vec<u8>, code: i32 },
    /// It stopped on a refusal it reported: the program keeping a promise
    /// its source made, which node does not make. Nothing is compared past
    /// it, and what it printed before must be what node printed first.
    Declined { stdout: Vec<u8>, line: String },
    /// It stopped by a signal or a fault no refusal explains.
    Aborted { stdout: Vec<u8>, what: String },
    /// The supervisor stopped it at the compiled-call allowance.
    Stopped(check_report::Incomplete),
}

/// The driver node runs for a whole program: the module is the program, and
/// node ends it the way it ends any program, when its loop drains, with its
/// own exit status. The `exit` line is the driver's terminal marker, written
/// on the results channel so the program's stdout stays its own.
pub(super) fn driver(import: &str) -> String {
    format!(
        "import {{ openSync, writeSync }} from \"node:fs\";\n\
         // A whole program: no case is called. The module is the program, and\n\
         // it ends as node ends any program, with its own exit status.\n\
         const resultsFd = openSync(process.env.NTS_DIFF_RESULTS, \"a\");\n\
         function emit(line) {{ writeSync(resultsFd, line); }}\n\
         process.on(\"exit\", (code) => {{ emit(`exit ${{code}}\\n`); }});\n\
         await import({import:?});\n"
    )
}

/// Why the deterministic host cannot run this program as the shipped one
/// would, or `None` when nothing it reaches depends on that host. A program
/// that calls native code has completions, threads and I/O of its own, and
/// node cannot call it either; one on another platform's loop needs that loop.
pub(super) fn host_dependence(program: &hir::Program) -> Option<String> {
    let named = |what: &str, names: &[String]| {
        (!names.is_empty()).then(|| format!("{what} {}", names.join(", ")))
    };
    let reason = if program.objc {
        Some("sends Objective-C messages".to_owned())
    } else {
        named("links native frameworks", &program.native_frameworks)
            .or_else(|| named("links native libraries", &program.native_libraries))
            .or_else(|| {
                named(
                    "links native packages",
                    &program
                        .native_packages
                        .iter()
                        .map(|package| package.name.clone())
                        .collect::<Vec<_>>(),
                )
            })
            .or_else(|| named("calls native code from", &program.native_headers))
            .or_else(|| {
                let mut members = program.foreign.keys().cloned().collect::<Vec<_>>();
                members.sort_unstable();
                named("calls foreign members", &members)
            })
            .or_else(|| {
                (!program.foreign_classes.is_empty())
                    .then(|| "constructs foreign classes".to_owned())
            })
    }?;
    Some(format!(
        "a whole program is compared on the deterministic host, and this one {reason}, \
         which that host does not run as the shipped program would and node cannot call"
    ))
}

/// Why lowering keeps this whole program from being compared, decided from
/// the compiled program alone, or `None` when it can be. Its record plays no
/// part: a pending program declines here exactly as it will once its row is
/// recorded, so the landing that adds it sees the verdict, not the records
/// commit after it.
///
/// Only a refusal that changed what module evaluation runs keeps the program
/// from being its source. A refused function evaluation calls cascades into
/// one of those cuts (`drop_callers_of_refused`); one no evaluation reaches
/// cannot change what it prints. A refusal the program makes at run time -- a
/// `!` that does not hold -- stops it with its own `nts: refused` line, which
/// declines when it runs. Then a program the deterministic host cannot run as
/// the shipped one would ([`host_dependence`]) declines.
pub(super) fn compile_time_decline(
    program: &hir::Program,
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Option<String> {
    let cuts = &program.module_evaluation_cuts;
    if !cuts.is_empty() {
        let mut places = nts_diagnostics::SourceLocations::new(&snapshot.sources);
        let named = cuts
            .iter()
            .map(|cut| places.where_it_is(cut))
            .collect::<Vec<_>>()
            .join(", ");
        return Some(format!(
            "a whole program is compared whole, and lowering changed what its module \
             evaluation runs at {named}, refused as listed above; nothing can be compared \
             until those refusals are removed or supported"
        ));
    }
    host_dependence(program)
}

/// Compare a whole program: one run on the backend, one under node.
pub(super) fn check(
    check: &PreparedCheck,
    backend: Backend,
    tsconfig: &Utf8Path,
    coverage: &oracle_coverage::ProgramCoverage,
    oracle_manifest: Option<&Utf8Path>,
    refusals: Vec<check_report::Refusal>,
) -> Result<Report> {
    // The batch owner's completed image, when it supplied one.
    let supplied = oracle_manifest
        .map(|manifest| oracle_emit::read_prepared(manifest, &check.entry, tsconfig))
        .transpose()
        .map_err(|error| annotate(error, FailureKind::OracleExecution))?;
    if let Some(declined) = compile_time_decline(&check.prepared.program, &check.snapshot) {
        return Err(with_failure(
            anyhow::anyhow!(declined),
            FailureKind::BackendDeclined,
            refusals,
            None,
        ));
    }
    // A program no row names yet compares nothing until the full check
    // records node's answer; only after its compile-time declines, which no
    // row can change.
    if let oracle_coverage::ProgramRecord::Pending(pending) = &coverage.record {
        if let Some(prepared) = &supplied {
            oracle_emit::finish_snapshot(prepared)
                .map_err(|error| annotate(error, FailureKind::OracleExecution))?;
        }
        return Ok(Report {
            refusals,
            pending: Some(pending.clone()),
            ..Report::default()
        });
    }
    let scratch = super::Scratch::for_check()?;
    let dir = &scratch.path;
    let native =
        run_native(dir, check, backend).map_err(|error| annotate(error, FailureKind::Execution))?;
    let node = node_answer(dir, check, tsconfig, supplied)
        .map_err(
            |error| match error.downcast::<oracle_coverage::BudgetExceeded>() {
                // A recorded stop that stops again is the record holding.
                Ok(budget) => oracle_coverage::BudgetExceeded {
                    recorded: coverage.budget.is_some(),
                    ..budget
                }
                .into(),
                Err(error) => error,
            },
        )
        .map_err(|error| annotate(error, FailureKind::OracleExecution))?;
    if let oracle_coverage::ProgramRecord::Answer(recorded) = &coverage.record
        && !node.matches(recorded)
    {
        return Err(with_failure(
            anyhow::anyhow!(
                "oracle not measured: node answered {} stdout byte(s) (sha256 {}) and exit {}, \
                     where its program row records {} byte(s) (sha256 {}) and exit {}; \
                     re-record it explicitly",
                node.stdout.len(),
                node.digest(),
                node.exit_code,
                recorded.stdout_bytes,
                recorded.stdout_sha256,
                recorded.exit_code
            ),
            FailureKind::OracleCoverage,
            Vec::new(),
            oracle_coverage::root_and_source(&check.entry).map(|(_, source)| source),
        ));
    }
    let mut report = compare(&native, &node);
    report.refusals = refusals;
    case_costs::event(
        serde_json::json!({"event":"report", "programs":1, "checked":report.checked,
            "refused":report.refused, "timeouts":report.timeouts, "aborts":report.aborts.len(),
            "disagreements":report.disagreements.len()}),
    );
    Ok(report)
}

/// The report of one whole-program comparison: one program, compared whole
/// when both sides ran to an end.
pub(super) fn compare(native: &Native, node: &Answer) -> Report {
    let mut report = Report {
        programs: 1,
        expected: 1,
        node_received: 1,
        ..Report::default()
    };
    match native {
        Native::Exited { stdout, code } => {
            report.checked = 1;
            report.disagreements = stdout_disagreements(stdout, &node.stdout);
            if *code != node.exit_code {
                report.disagreements.push((
                    format!("exit status {code}"),
                    format!("exit status {}", node.exit_code),
                ));
            }
        }
        Native::Declined { stdout, line } => {
            report.refused = 1;
            if !node.stdout.starts_with(stdout) {
                report.checked = 1;
                report.refused = 0;
                report.disagreements = stdout_disagreements(stdout, &node.stdout);
                report
                    .disagreements
                    .push((format!("declined: {line}"), "ran on".to_owned()));
            }
        }
        Native::Aborted { stdout, what } => {
            report.checked = 1;
            report.aborts.push(what.clone());
            report.disagreements = stdout_disagreements(stdout, &node.stdout);
        }
        Native::Stopped(incomplete) => {
            report.timeouts = 1;
            report.incomplete.push(incomplete.clone());
        }
    }
    report
}

/// Every line that differs, and the bytes themselves when the lines agree
/// but the bytes do not: a missing final newline is a difference too.
fn stdout_disagreements(native: &[u8], node: &[u8]) -> Vec<(String, String)> {
    if native == node {
        return Vec::new();
    }
    let mut found = output_disagreements(&lines(native), &lines(node));
    if found.is_empty() {
        found.push((
            format!("stdout {} byte(s), ending {:?}", native.len(), tail(native)),
            format!("stdout {} byte(s), ending {:?}", node.len(), tail(node)),
        ));
    }
    found
}

fn tail(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(16)..]).into_owned()
}

/// Build the harness with no cases and run it once, bounded by the backend's
/// compiled-call allowance.
fn run_native(dir: &Utf8Path, check: &PreparedCheck, backend: Backend) -> Result<Native> {
    let program = &check.prepared.program;
    let sources = &check.snapshot.sources;
    let limits = super::call_limits(backend)?;
    let path = dir.join("results-program.txt");
    let _ = std::fs::remove_file(&path);
    let (finished, marker) = match backend {
        // The shipped JVM entry, on the harness's classes: it evaluates the
        // module and drains its environment, timers included, then exits.
        Backend::Jvm => {
            let built = super::build_jvm(dir, program, sources, &[])?;
            let _execution = case_costs::span("program.total");
            (
                call_activity::command(built.program(), limits)?,
                Marker::None,
            )
        }
        Backend::C | Backend::Llvm => {
            let binary = super::build_native(dir, program, sources, &[])?;
            let _execution = case_costs::span("program.total");
            let mut command = super::bounded_native(binary.as_str());
            command.env("NTS_DIFF_RESULTS", path.as_str()).arg("0");
            (
                call_activity::run(command, &path, 0, 0, limits)?,
                Marker::Harness(super::run_done(&path)),
            )
        }
    };
    case_costs::child_result("program.attempt", &finished.output);
    Ok(native_outcome(finished, marker))
}

/// The terminal marker a compiled run leaves: the C harness writes `done 0`
/// once its loop drains, and the JVM's shipped `NtsMain` writes none.
#[derive(Debug, Clone, Copy)]
enum Marker {
    Harness(Option<usize>),
    None,
}

/// How the run ended, from its supervisor, its status and what it said.
fn native_outcome(finished: call_activity::Finished, marker: Marker) -> Native {
    let output = finished.output;
    if let Some(incomplete) = finished.incomplete {
        return Native::Stopped(incomplete);
    }
    let complaint = String::from_utf8_lossy(&output.stderr);
    let stdout = output.stdout;
    let signal = signal_of(output.status);
    if output.status.success() {
        // An exit 0 without the harness's marker left the harness early,
        // which no program can do on purpose.
        if let Marker::Harness(done) = marker
            && done != Some(0)
        {
            return Native::Aborted {
                stdout,
                what: "exited 0 without its `done` line: the harness did not finish".to_owned(),
            };
        }
        return Native::Exited { stdout, code: 0 };
    }
    if let Stopped::Defect(what) = stopped_with(output.status.code(), signal, &complaint) {
        return Native::Aborted { stdout, what };
    }
    // A refusal the runtime reported, whether it then aborted (C) or exited
    // with C's status (the JVM): the program declining, not answering.
    if let Some(line) = complaint
        .lines()
        .rev()
        .find(|line| line.starts_with(super::REFUSED) || line.starts_with(super::EXHAUSTED))
    {
        return Native::Declined {
            stdout,
            line: line.to_owned(),
        };
    }
    match output.status.code() {
        Some(code) => Native::Exited { stdout, code },
        None => Native::Aborted {
            stdout,
            what: format!(
                "killed by {}: {}",
                output.status,
                complaint.lines().next().unwrap_or("no message")
            ),
        },
    }
}

/// Node's answer: from the batch producer's shared reference when the gate
/// supplied one, else from one run under this check's prepared image.
fn node_answer(
    dir: &Utf8Path,
    check: &PreparedCheck,
    tsconfig: &Utf8Path,
    supplied: Option<oracle_emit::Prepared>,
) -> Result<Answer> {
    let absolute = check.entry.canonicalize_utf8()?;
    let driver = driver(&format!("file://{absolute}"));
    if supplied.is_none() && std::env::var_os("NTS_PROGRAM_ORACLE").is_some() {
        let reference = oracle_emit::program_reference(dir, tsconfig, &absolute, &driver)?
            .context("program oracle handoff disappeared")?;
        if let Some(budget) = &reference.budget {
            return Err(oracle_coverage::BudgetExceeded {
                budget: budget.clone(),
                recorded: false,
            }
            .into());
        }
        return Ok(Answer {
            exit_code: reference
                .exit_code
                .context("program oracle reference is not a whole program's answer")?,
            stdout: reference.stdout,
        });
    }
    let prepared = match supplied {
        Some(prepared) => prepared,
        None => oracle_emit::prepare(dir, &absolute, tsconfig)?,
    };
    let answer = execute(dir, &absolute, &driver, &prepared);
    // The complete original-fact replay runs whatever the run answered, and
    // a changed snapshot takes precedence over it.
    oracle_emit::finish_snapshot(&prepared)?;
    answer.map(|(answer, _)| answer)
}

/// One run of the whole-program driver under a prepared image, and the most
/// the oracle's own resident scope held.
pub(super) fn execute(
    dir: &Utf8Path,
    entry: &Utf8Path,
    driver_text: &str,
    prepared: &oracle_emit::Prepared,
) -> Result<(Answer, Option<u64>)> {
    let launch = super::NodeLaunch::new(dir, driver_text, prepared)?;
    let results = launch.results.clone();
    let finished = launch.run(entry)?;
    let marker = std::fs::read(&results).unwrap_or_default();
    let answer = measured(&finished.status, &marker, finished.output.stdout)?;
    Ok((answer, finished.resident_peak_bytes))
}

/// Node's run as an answer, or why it is not one: a budget, a supervisor
/// stop, a signal, or a driver that did not reach its `exit` line.
fn measured(status: &Value, marker: &[u8], stdout: Vec<u8>) -> Result<Answer> {
    if !status["budget"].is_null() {
        return Err(oracle_coverage::BudgetExceeded {
            budget: status["budget"].clone(),
            recorded: false,
        }
        .into());
    }
    ensure!(
        status["version"] == 2 && status["error"].is_null() && status["stop"].is_null(),
        "oracle not measured: the whole program's supervisor did not complete: {status}"
    );
    if !status["signal"].is_null() {
        bail!(
            "oracle not measured: node ended the whole program by {}",
            status["signal"]
        );
    }
    let exit_code = status["exit_code"]
        .as_i64()
        .and_then(|code| i32::try_from(code).ok())
        .context("oracle not measured: the whole program has no exit status")?;
    let said = String::from_utf8_lossy(marker);
    ensure!(
        said.lines().last() == Some(format!("exit {exit_code}").as_str()),
        "oracle not measured: the whole-program driver ended with exit {exit_code} but wrote {said:?}"
    );
    Ok(Answer { stdout, exit_code })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use std::os::unix::process::ExitStatusExt as _;

    fn exited(stdout: &[u8], code: i32) -> Native {
        Native::Exited {
            stdout: stdout.to_vec(),
            code,
        }
    }

    fn node(stdout: &[u8], exit_code: i32) -> Answer {
        Answer {
            stdout: stdout.to_vec(),
            exit_code,
        }
    }

    fn finished(stdout: &[u8], stderr: &[u8], raw: i32) -> call_activity::Finished {
        std::process::Output {
            status: std::process::ExitStatus::from_raw(raw),
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
        .into()
    }

    const LINES: &[u8] = b"one\ntwo\nthree\n";

    #[test]
    fn the_same_stdout_and_status_agree() {
        let report = compare(&exited(LINES, 0), &node(LINES, 0));
        assert!(report.agreed(), "{report:?}");
        assert_eq!(report.status(), check_report::Status::Agrees);
        assert_eq!((report.programs, report.functions), (1, 0));
    }

    #[test]
    fn a_control_printing_one_different_line_disagrees_on_that_line() {
        let report = compare(&exited(b"one\nTWO\nthree\n", 0), &node(LINES, 0));
        assert_eq!(report.status(), check_report::Status::Disagrees);
        assert_eq!(
            report.disagreements,
            vec![("output 1: TWO".to_owned(), "output 1: two".to_owned())]
        );
    }

    #[test]
    fn bytes_that_differ_only_past_the_lines_still_disagree() {
        let report = compare(&exited(b"one\ntwo\nthree", 0), &node(LINES, 0));
        assert_eq!(report.status(), check_report::Status::Disagrees);
        assert_eq!(report.disagreements.len(), 1);
    }

    #[test]
    fn an_uncaught_throw_is_status_one_on_both_sides_and_agrees() {
        let native = native_outcome(
            finished(b"before\n", b"nts: uncaught Error: boom\n", 1 << 8),
            Marker::Harness(None),
        );
        assert!(
            matches!(native, Native::Exited { code: 1, .. }),
            "{native:?}"
        );
        assert!(compare(&native, &node(b"before\n", 1)).agreed());
    }

    #[test]
    fn a_different_exit_status_disagrees() {
        let report = compare(&exited(LINES, 1), &node(LINES, 0));
        assert_eq!(report.status(), check_report::Status::Disagrees);
        assert_eq!(
            report.disagreements,
            vec![("exit status 1".to_owned(), "exit status 0".to_owned())]
        );
    }

    #[test]
    fn a_signal_is_an_abort_never_a_status() {
        let native = native_outcome(finished(b"one\n", b"", 11), Marker::Harness(None));
        assert!(matches!(native, Native::Aborted { .. }), "{native:?}");
        let report = compare(&native, &node(LINES, 0));
        assert_eq!(report.status(), check_report::Status::Disagrees);
        let report = compare(&native, &node(b"one\n", 0));
        assert_eq!(report.status(), check_report::Status::Aborted);
        assert!(!report.status().succeeds());
    }

    #[test]
    fn a_reported_refusal_declines_and_compares_its_prefix() {
        let native = native_outcome(
            finished(b"one\n", b"nts: refused: an index out of range\n", 6),
            Marker::Harness(None),
        );
        assert!(matches!(native, Native::Declined { .. }), "{native:?}");
        let report = compare(&native, &node(LINES, 0));
        assert_eq!(report.status(), check_report::Status::AllDeclined);
        assert!(!report.status().succeeds());
        let report = compare(&native, &node(b"other\n", 0));
        assert_eq!(report.status(), check_report::Status::Disagrees);
    }

    #[test]
    fn exit_zero_without_the_harness_marker_is_an_abort() {
        let native = native_outcome(finished(LINES, b"", 0), Marker::Harness(None));
        assert!(matches!(native, Native::Aborted { .. }), "{native:?}");
        let native = native_outcome(finished(LINES, b"", 0), Marker::Harness(Some(0)));
        assert!(
            matches!(native, Native::Exited { code: 0, .. }),
            "{native:?}"
        );
        let native = native_outcome(finished(LINES, b"", 0), Marker::None);
        assert!(
            matches!(native, Native::Exited { code: 0, .. }),
            "{native:?}"
        );
        // The JVM reports a refusal with C's status rather than a signal.
        let native = native_outcome(
            finished(b"", b"nts: refused: an index out of range\n", 134 << 8),
            Marker::None,
        );
        assert!(matches!(native, Native::Declined { .. }), "{native:?}");
    }

    #[test]
    fn a_run_past_its_allowance_is_a_recorded_timeout() {
        let mut stopped = finished(b"", b"", 9);
        stopped.incomplete = Some(check_report::Incomplete {
            kind: check_report::IncompleteKind::Runaway,
            reason: "CPU allowance".into(),
            case_index: None,
        });
        let native = native_outcome(stopped, Marker::Harness(None));
        let report = compare(&native, &node(LINES, 0));
        assert_eq!((report.timeouts, report.incomplete.len()), (1, 1));
        assert_eq!(report.status(), check_report::Status::NotMeasured);
    }

    #[test]
    fn node_is_an_answer_only_when_its_driver_reached_its_exit_line() {
        let status = |code: Value, signal: Value| serde_json::json!({"version":2,"exit_code":code,"signal":signal,"stop":null,"budget":null,"error":null});
        let answer =
            measured(&status(1.into(), Value::Null), b"exit 1\n", b"x\n".to_vec()).unwrap();
        assert_eq!(answer, node(b"x\n", 1));
        assert!(measured(&status(0.into(), Value::Null), b"", Vec::new()).is_err());
        assert!(measured(&status(0.into(), Value::Null), b"exit 1\n", Vec::new()).is_err());
        assert!(measured(&status(Value::Null, "SIGKILL".into()), b"", Vec::new()).is_err());
    }

    #[test]
    fn a_recorded_answer_binds_bytes_digest_and_status() {
        let answer = node(LINES, 0);
        let recorded = Recorded {
            stdout_sha256: answer.digest(),
            stdout_bytes: LINES.len(),
            exit_code: 0,
        };
        assert!(answer.matches(&recorded));
        assert!(!node(LINES, 1).matches(&recorded));
        assert!(!node(b"one\n", 0).matches(&recorded));
    }

    #[test]
    fn the_driver_keeps_the_hook_the_recorder_times() {
        // record-oracles.ts stamps CPU at this exact line.
        assert!(
            driver("file:///x.ts").contains("function emit(line) { writeSync(resultsFd, line); }")
        );
        assert!(!driver("file:///x.ts").contains("process.exit("));
    }

    #[test]
    fn a_program_calling_native_code_depends_on_the_shipped_host() {
        let mut program = hir::Program::default();
        assert_eq!(host_dependence(&program), None);
        program.native_headers.push("stdio.h".into());
        assert!(host_dependence(&program).unwrap().contains("stdio.h"));
        let program = hir::Program {
            objc: true,
            ..hir::Program::default()
        };
        assert!(host_dependence(&program).unwrap().contains("Objective-C"));
    }
}
