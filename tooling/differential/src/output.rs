//! A native stop can omit the oracle's suffix, never change its prefix.
//! Process boundaries come from the collector, independently of program output.

use std::ops::Range;

use anyhow::{Context as _, Result};

use super::Run;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Printed {
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
}

impl Printed {
    fn is_empty(&self) -> bool {
        self.stdout.is_empty() && self.stderr.is_empty()
    }
}

pub(super) struct Oracle<'a> {
    pub(super) dir: &'a camino::Utf8Path,
    pub(super) entry: &'a camino::Utf8Path,
    project: &'a camino::Utf8Path,
    prepared: std::cell::RefCell<Option<super::oracle_emit::Prepared>>,
    reference: std::cell::RefCell<Option<super::oracle_emit::ProgramReference>>,
    shared: bool,
    pub(super) compiled: &'a [super::Testable],
    pub(super) sources: &'a [nts_diagnostics::SourceFile],
    pub(super) coverage: &'a super::oracle_coverage::Coverage,
}

impl<'a> Oracle<'a> {
    // Shared answers need no emitter. A selected-window replay opens only the
    // producer's authenticated executable image, and proves its loader ready.
    pub(super) fn prepare(
        check: &'a super::PreparedCheck,
        dir: &'a camino::Utf8Path,
        tsconfig: &'a camino::Utf8Path,
        compiled: &'a [super::Testable],
        coverage: &'a super::oracle_coverage::Coverage,
        supplied: Option<super::oracle_emit::Prepared>,
    ) -> Result<Self> {
        let absolute = check.entry.canonicalize_utf8()?;
        let shared = std::env::var_os("NTS_PROGRAM_ORACLE").is_some();
        let prepared = match (supplied, shared) {
            (Some(prepared), _) => Some(prepared),
            (None, true) => None,
            (None, false) => Some(
                super::oracle_emit::prepare(dir, &absolute, tsconfig).map_err(|error| {
                    if let Some(budget) =
                        error.downcast_ref::<super::oracle_coverage::BudgetExceeded>()
                    {
                        super::oracle_coverage::BudgetExceeded {
                            budget: budget.budget.clone(),
                            recorded: coverage.budget.is_some(),
                        }
                        .into()
                    } else {
                        error
                    }
                })?,
            ),
        };
        Ok(Self {
            dir,
            entry: &check.entry,
            project: tsconfig,
            compiled,
            sources: &check.snapshot.sources,
            coverage,
            prepared: std::cell::RefCell::new(prepared),
            reference: std::cell::RefCell::new(None),
            shared,
        })
    }

    pub(super) fn finish(self) -> Result<()> {
        if let Some(prepared) = self.prepared.into_inner() {
            super::oracle_emit::finish_snapshot(&prepared)?;
        }
        Ok(())
    }

    pub(super) fn run(&self, testable: &[super::Testable]) -> Result<Run> {
        if self.shared {
            // Native dispatch is complete. Replay the original facts at the
            // point this answer is actually used, rather than before dispatch.
            let absolute = self.entry.canonicalize_utf8()?;
            let reference = super::oracle_emit::program_reference(
                self.dir,
                self.project,
                &absolute,
                &super::driver(&format!("file://{absolute}"), testable, super::Engine::Node),
            )?
            .context("program oracle handoff disappeared")?;
            if let Some(budget) = &reference.budget {
                return Err(super::oracle_coverage::BudgetExceeded {
                    budget: budget.clone(),
                    recorded: self.coverage.budget.is_some(),
                }
                .into());
            }
            anyhow::ensure!(
                reference.rows.len() == self.coverage.count,
                "program oracle reference has a different population"
            );
            let run = Run {
                results: reference.rows.clone(),
                output: Printed {
                    stdout: reference.stdout.clone(),
                    stderr: reference.stderr.clone(),
                },
                segments: Vec::new(),
                thrown: Vec::new(),
                incomplete: Vec::new(),
            };
            *self.reference.borrow_mut() = Some(reference);
            return Ok(run);
        }
        let prepared = self.prepared.borrow();
        super::run_node_cases(
            self.dir,
            self.entry,
            &super::interleaved(testable),
            self.sources,
            self.coverage,
            prepared
                .as_ref()
                .context("missing oracle execution image")?,
        )
    }

    pub(super) fn compare(
        &self,
        native: &Run,
        node: &Run,
        aborts: &[String],
    ) -> Result<Comparison> {
        if self.compiled.is_empty() || !native.incomplete.is_empty() || !aborts.is_empty() {
            return Ok(Comparison::default());
        }
        let mut cases = None;
        compare(native, node, |window| {
            let cases = cases.get_or_insert_with(|| super::interleaved(self.compiled));
            let selected = cases
                .get(window)
                .context("invalid output oracle case window")?;
            let ids = selected
                .iter()
                .map(|(one, at, tuple)| format!("{} {at} {tuple:?}", one.name))
                .collect::<Vec<_>>();
            let identity = serde_json::to_vec(&(&self.coverage.key, ids))?;
            let coverage = super::oracle_coverage::Coverage {
                count: selected.len(),
                key: format!("{:032x}", xxhash_rust::xxh3::xxh3_128(&identity)),
                budget: None,
            };
            if self.prepared.borrow().is_none() {
                let reference = self.reference.borrow();
                let reference = reference
                    .as_ref()
                    .context("missing program oracle reference")?;
                anyhow::ensure!(
                    reference
                        .replay
                        .as_ref()
                        .context("program oracle has no executable replay")?
                        .snapshot["manifestSha256"]
                        == super::oracle_emit::digest(&std::fs::read(
                            &reference
                                .replay
                                .as_ref()
                                .context("program oracle has no executable replay")?
                                .manifest
                        )?),
                    "program oracle replay original proof changed"
                );
                *self.prepared.borrow_mut() = Some(super::oracle_emit::read_prepared(
                    &reference
                        .replay
                        .as_ref()
                        .context("program oracle has no executable replay")?
                        .manifest,
                    self.entry,
                    self.project,
                )?);
            }
            super::case_costs::event(
                serde_json::json!({"event":"oracle.window","shared":self.shared,"cases":selected.len()}),
            );
            let prepared = self.prepared.borrow();
            super::run_node_cases(
                self.dir,
                self.entry,
                selected,
                self.sources,
                &coverage,
                prepared.as_ref().context("missing oracle window image")?,
            )
            .map(|run| run.output)
        })
    }
}

impl Printed {
    pub(super) fn record(
        &mut self,
        segments: &mut Vec<Segment>,
        cases: Range<usize>,
        run: &std::process::Output,
        stopped: bool,
    ) -> Option<String> {
        let stdout = self.stdout.len();
        let stderr = self.stderr.len();
        self.stdout.extend_from_slice(&run.stdout);
        let terminal = stopped.then(|| terminal_diagnostic(&run.stderr)).flatten();
        self.stderr.extend_from_slice(
            terminal.map_or(run.stderr.as_slice(), |(end, _)| &run.stderr[..end]),
        );
        let source_throw = terminal
            .filter(|(_, line)| line.starts_with(super::UNCAUGHT.as_bytes()))
            .map(|(_, line)| {
                String::from_utf8_lossy(line)
                    .trim_end_matches(['\r', '\n'])
                    .to_owned()
            });
        segments.push(Segment {
            cases,
            stdout: stdout..self.stdout.len(),
            stderr: stderr..self.stderr.len(),
            native_decline: stopped && source_throw.is_none(),
        });
        source_throw
    }
}

pub(super) struct Segment {
    pub(super) cases: Range<usize>,
    pub(super) stdout: Range<usize>,
    pub(super) stderr: Range<usize>,
    pub(super) native_decline: bool,
}

/// The final runtime diagnostic is metadata; earlier lookalike lines are not.
fn terminal_diagnostic(stderr: &[u8]) -> Option<(usize, &[u8])> {
    let mut boundary = None;
    let mut at = 0;
    for line in stderr.split_inclusive(|byte| *byte == b'\n') {
        if line.starts_with(super::REFUSED.as_bytes())
            || line.starts_with(super::EXHAUSTED.as_bytes())
            || line.starts_with(super::UNCAUGHT.as_bytes())
            || line.starts_with(b"java.lang.OutOfMemoryError")
            || line.starts_with(b"java.lang.StackOverflowError")
            || line.starts_with(b"java.lang.reflect.InvocationTargetException")
            || line.starts_with(b"nts.rt.NtsRefusal")
            || line.starts_with(b"Exception in thread ")
        {
            boundary = Some((at, line));
        }
        at += line.len();
    }
    boundary
}

#[cfg(test)]
fn before_terminal_diagnostic(stderr: &[u8]) -> &[u8] {
    terminal_diagnostic(stderr).map_or(stderr, |(end, _)| &stderr[..end])
}

#[derive(Default)]
pub(super) struct Comparison {
    pub(super) disagreements: Vec<(String, String)>,
    pub(super) rejected_declines: usize,
}

pub(super) fn compare(
    native: &Run,
    node: &Run,
    mut oracle: impl FnMut(Range<usize>) -> Result<Printed>,
) -> Result<Comparison> {
    // The full oracle has already proved its complete population. No output
    // means each process has the empty prefix, with no window replays.
    if native.output.is_empty() && node.output.is_empty() {
        return Ok(Comparison::default());
    }
    if native.segments.len() <= 1 && !native.segments.iter().any(|segment| segment.native_decline) {
        let mut disagreements = super::output_disagreements(
            &super::lines(&native.output.stdout),
            &super::lines(&node.output.stdout),
        );
        disagreements.extend(
            super::output_disagreements(
                &super::lines(&native.output.stderr),
                &super::lines(&node.output.stderr),
            )
            .into_iter()
            .map(|(ours, theirs)| {
                (
                    ours.replacen("output ", "stderr ", 1),
                    theirs.replacen("output ", "stderr ", 1),
                )
            }),
        );
        return Ok(Comparison {
            disagreements,
            rejected_declines: 0,
        });
    }
    let mut comparison = Comparison::default();
    for segment in &native.segments {
        // Each fresh process gets a fresh module and only its case window.
        // A failed oracle propagates as unmeasured, never a shorter reference.
        let expected = oracle(segment.cases.clone())?;
        let stdout = &native.output.stdout[segment.stdout.clone()];
        let stderr = &native.output.stderr[segment.stderr.clone()];
        let agrees = if segment.native_decline {
            expected.stdout.starts_with(stdout) && expected.stderr.starts_with(stderr)
        } else {
            expected.stdout == stdout && expected.stderr == stderr
        };
        if !agrees {
            comparison.disagreements.push((
                format!(
                    "output cases {:?}: stdout {stdout:?}, stderr {stderr:?}",
                    segment.cases
                ),
                format!("output cases {:?}: {expected:?}", segment.cases),
            ));
            comparison.rejected_declines += usize::from(segment.native_decline);
        }
    }
    Ok(comparison)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn run(output: &[u8], segments: Vec<Segment>) -> Run {
        Run {
            results: Vec::new(),
            output: Printed {
                stdout: output.to_vec(),
                stderr: Vec::new(),
            },
            segments,
            thrown: Vec::new(),
            incomplete: Vec::new(),
        }
    }

    fn stop(bytes: Range<usize>, cases: Range<usize>) -> Segment {
        Segment {
            cases,
            stdout: bytes,
            stderr: 0..0,
            native_decline: true,
        }
    }

    #[test]
    fn missing_finally_output_after_a_stop_is_a_decline() {
        let native = run(b"before\n", vec![stop(0..7, 0..1)]);
        let node = run(b"before\nfinally\n", Vec::new());
        let compared = compare(&native, &node, |_| Ok(node.output.clone())).unwrap();
        assert_eq!(compared.disagreements, Vec::<(String, String)>::new());
        assert_eq!(compared.rejected_declines, 0);
    }

    #[test]
    fn wrong_output_before_a_stop_is_wrong_and_not_declined() {
        let native = run(b"wrong\n", vec![stop(0..6, 0..1)]);
        let node = run(b"right\nfinally\n", Vec::new());
        let compared = compare(&native, &node, |_| Ok(node.output.clone())).unwrap();
        assert_eq!(compared.disagreements.len(), 1);
        assert_eq!(compared.rejected_declines, 1);
    }

    #[test]
    fn restarts_cannot_borrow_a_previous_runs_missing_suffix() {
        let native = run(
            b"before\nafter\n",
            vec![stop(0..7, 0..1), stop(7..13, 1..2)],
        );
        let node = run(b"before\nafter\n", Vec::new());
        let compared = compare(&native, &node, |window| {
            assert!(window == (0..1) || window == (1..2));
            Ok(Printed {
                stdout: b"before\nafter\n".to_vec(),
                stderr: Vec::new(),
            })
        })
        .unwrap();
        assert_eq!(compared.rejected_declines, 1);
    }

    #[test]
    fn completed_and_source_throw_runs_still_require_the_entire_output() {
        let native = run(
            b"before\n",
            vec![Segment {
                cases: 0..1,
                stdout: 0..7,
                stderr: 0..0,
                native_decline: false,
            }],
        );
        let node = run(b"before\nfinally\n", Vec::new());
        let compared = compare(&native, &node, |_| panic!("no native stop to replay")).unwrap();
        assert_eq!(compared.disagreements.len(), 1);
        assert_eq!(compared.rejected_declines, 0);
    }

    #[test]
    fn empty_output_uses_the_measured_full_oracle_without_replay() {
        let native = run(b"", vec![stop(0..0, 0..1)]);
        let node = run(b"", Vec::new());
        let compared = compare(&native, &node, |_| panic!("empty output needs no replay")).unwrap();
        assert_eq!(compared.disagreements, Vec::<(String, String)>::new());
    }

    #[test]
    fn an_incomplete_window_oracle_is_unmeasured() {
        let native = run(b"before\n", vec![stop(0..7, 0..1)]);
        let node = run(b"before\nfinally\n", Vec::new());
        assert!(compare(&native, &node, |_| anyhow::bail!("oracle stopped")).is_err());
    }

    #[test]
    fn earlier_diagnostic_shaped_stderr_is_still_program_output() {
        assert_eq!(
            before_terminal_diagnostic(b"nts: refused: source line\nnts: refused: actual stop\n"),
            b"nts: refused: source line\n"
        );
        assert_eq!(
            before_terminal_diagnostic(
                b"before\njava.lang.StackOverflowError\n\tat program.method(Program.java:1)\n"
            ),
            b"before\n"
        );
    }

    #[test]
    fn native_stops_preserve_output_prefixes_on_every_backend() {
        const NAME: &str = "output::tests::native_stops_preserve_output_prefixes_on_every_backend";
        if std::env::var_os("NTS_OUTPUT_PREFIX_ARM").is_none() {
            for (backend, rc) in [
                ("c", false),
                ("llvm", false),
                ("jvm", false),
                ("c", true),
                ("llvm", true),
            ] {
                eprintln!("native prefix arm starts: {backend}, RC={rc}");
                let output = crate::self_test::run(NAME, |command| {
                    command
                        .env("NTS_OUTPUT_PREFIX_ARM", backend)
                        .env("NTS_BACKEND", backend);
                    if rc {
                        command.env("NTS_RC", "1");
                    } else {
                        command.env_remove("NTS_RC");
                    }
                });
                assert!(
                    output.status.success(),
                    "{backend}, RC={rc}: child exit {}; stdout: {}; stderr: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            return;
        }
        let path = crate::scratch::ScratchDir::path_in_target("nts-output-prefix");
        let scratch = path;
        std::fs::create_dir_all(scratch.join("src")).unwrap();
        let main = scratch.join("src/main.ts");
        let config = scratch.join("tsconfig.json");
        let base =
            camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tsconfig.fixtures.json");
        std::fs::write(
            &config,
            serde_json::json!({"extends":base,"include":["src/main.ts"]}).to_string(),
        )
        .unwrap();
        let mut frontend =
            nts_frontend_ts::Frontend::new(&scratch).with_checkers(std::num::NonZeroU16::MIN);
        let source = |index: usize, wrong_print: bool, errors: bool| {
            format!(
                "export function probe(n:number):number {{ const printed={}; console.{}(printed[0]); const values=[n]; const result=values[{index}]; console.{}('after'); return result; }}",
                if wrong_print {
                    "new Array<number>(1)"
                } else {
                    "[0]"
                },
                if errors { "error" } else { "log" },
                if errors { "error" } else { "log" }
            )
        };
        for errors in [false, true] {
            for (index, wrong_print, compared, declined) in
                [(0, false, 29, 0), (2, false, 0, 29), (2, true, 29, 0)]
            {
                std::fs::write(&main, source(index, wrong_print, errors)).unwrap();
                let report = super::super::check(&config, &mut frontend).unwrap();
                assert!(
                    report.aborts.is_empty() && report.incomplete.is_empty(),
                    "{report:?}"
                );
                assert_eq!(
                    (report.checked, report.refused),
                    (compared, declined),
                    "{report:?}"
                );
                assert_eq!(
                    report.disagreements.len(),
                    if wrong_print { 29 } else { 0 },
                    "{report:?}"
                );
                if index == 0 {
                    assert!(report.agreed(), "{report:?}");
                }
            }
        }
    }
}
