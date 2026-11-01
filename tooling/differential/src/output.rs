//! A native stop can omit the oracle's suffix, never change its prefix.
//! Process boundaries come from the collector, independently of program output.

use std::ops::Range;

use anyhow::Result;

use super::Run;

pub(super) struct Segment {
    pub(super) cases: Range<usize>,
    pub(super) bytes: Range<usize>,
    pub(super) native_decline: bool,
}

#[derive(Default)]
pub(super) struct Comparison {
    pub(super) disagreements: Vec<(String, String)>,
    pub(super) rejected_declines: usize,
}

pub(super) fn compare(
    native: &Run,
    node: &Run,
    mut oracle: impl FnMut(Range<usize>) -> Result<Vec<u8>>,
) -> Result<Comparison> {
    if !native.segments.iter().any(|segment| segment.native_decline) {
        return Ok(Comparison {
            disagreements: super::output_disagreements(
                &super::lines(&native.output),
                &super::lines(&node.output),
            ),
            rejected_declines: 0,
        });
    }
    // Neither side printed anything: every process has the empty prefix. The
    // full oracle above has already proved its complete case population.
    if native.output.is_empty() && node.output.is_empty() {
        return Ok(Comparison::default());
    }
    let mut comparison = Comparison::default();
    for segment in &native.segments {
        // A restart initializes the module afresh. Replaying exactly its case
        // window preserves that fact, including output before the first call.
        // The window oracle must complete; a failed replay propagates as an
        // unmeasured oracle, never as a decline or a shortened reference.
        let expected = oracle(segment.cases.clone())?;
        let printed = &native.output[segment.bytes.clone()];
        let agrees = if segment.native_decline {
            expected.starts_with(printed)
        } else {
            expected == printed
        };
        if !agrees {
            comparison.disagreements.push((
                format!("output cases {:?}: {printed:?}", segment.cases),
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
            output: output.to_vec(),
            segments,
            thrown: Vec::new(),
            incomplete: Vec::new(),
        }
    }

    fn stop(bytes: Range<usize>, cases: Range<usize>) -> Segment {
        Segment {
            cases,
            bytes,
            native_decline: true,
        }
    }

    #[test]
    fn missing_finally_output_after_a_stop_is_a_decline() {
        let native = run(b"before\n", vec![stop(0..7, 0..1)]);
        let node = run(b"before\nfinally\n", Vec::new());
        let compared = compare(&native, &node, |_| Ok(node.output.clone())).unwrap();
        assert!(compared.disagreements.is_empty());
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
            Ok(b"before\nafter\n".to_vec())
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
                bytes: 0..7,
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
        assert!(compared.disagreements.is_empty());
    }

    #[test]
    fn an_incomplete_window_oracle_is_unmeasured() {
        let native = run(b"before\n", vec![stop(0..7, 0..1)]);
        let node = run(b"before\nfinally\n", Vec::new());
        assert!(compare(&native, &node, |_| anyhow::bail!("oracle stopped")).is_err());
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
                let mut command = std::process::Command::new(std::env::current_exe().unwrap());
                command
                    .args(["--exact", NAME, "--nocapture"])
                    .env("NTS_OUTPUT_PREFIX_ARM", backend)
                    .env("NTS_BACKEND", backend);
                if rc {
                    command.env("NTS_RC", "1");
                } else {
                    command.env_remove("NTS_RC");
                }
                let output = command.output().unwrap();
                assert!(
                    output.status.success(),
                    "{backend}, RC={rc}: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            return;
        }
        let path = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-output-prefix-{}", std::process::id()));
        let scratch = super::super::Scratch::holding(path);
        std::fs::create_dir_all(scratch.path.join("src")).unwrap();
        let main = scratch.path.join("src/main.ts");
        let config = scratch.path.join("tsconfig.json");
        let base =
            camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tsconfig.fixtures.json");
        std::fs::write(
            &config,
            serde_json::json!({"extends":base,"include":["src/main.ts"]}).to_string(),
        )
        .unwrap();
        let mut frontend =
            nts_frontend_ts::Frontend::new(&scratch.path).with_checkers(std::num::NonZeroU16::MIN);
        let source = |index: usize, wrong_print: bool| {
            format!(
                "export function probe(n:number):number {{ const printed={}; console.log(printed[0]); const values=[n]; const result=values[{index}]; console.log('after'); return result; }}",
                if wrong_print {
                    "new Array<number>(1)"
                } else {
                    "[0]"
                }
            )
        };
        for (index, wrong_print, compared, declined) in
            [(0, false, 29, 0), (2, false, 0, 29), (2, true, 29, 0)]
        {
            std::fs::write(&main, source(index, wrong_print)).unwrap();
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
