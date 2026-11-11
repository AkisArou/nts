//! Child termination is an observation of a benchmark column. Failure to
//! launch or build the instrument remains an error, never an absent timing.

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum Outcome {
    RuntimeAbort {
        termination: Termination,
        stderr: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum Termination {
    Exit { code: i32 },
    Signal { signal: i32 },
}

impl Outcome {
    pub(super) fn validate(&self) -> Result<()> {
        match self {
            Self::RuntimeAbort {
                termination: Termination::Exit { code },
                ..
            } => {
                ensure!(*code != 0, "runtime abort cannot have a successful exit");
            }
            Self::RuntimeAbort {
                termination: Termination::Signal { signal },
                ..
            } => {
                ensure!(*signal > 0, "runtime abort signal must be positive");
            }
        }
        Ok(())
    }

    pub(super) fn of(output: &std::process::Output) -> Result<Self> {
        let termination = if let Some(code) = output.status.code() {
            Termination::Exit { code }
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                Termination::Signal {
                    signal: output
                        .status
                        .signal()
                        .context("child terminated without an exit code or signal")?,
                }
            }
            #[cfg(not(unix))]
            anyhow::bail!("child terminated without an exit code");
        };
        Ok(Self::RuntimeAbort {
            termination,
            stderr: String::from_utf8(output.stderr.clone())
                .context("benchmark stderr is not UTF-8")?,
        })
    }
}

impl std::fmt::Display for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RuntimeAbort {
                termination,
                stderr,
            } => {
                write!(f, "runtime abort ({termination}): {stderr}")
            }
        }
    }
}

impl std::fmt::Display for Termination {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Exit { code } => write!(f, "exit {code}"),
            Self::Signal { signal } => write!(f, "signal {signal}"),
        }
    }
}

impl std::error::Error for Outcome {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(super) enum Column {
    #[serde(rename = "nts_c")]
    C,
    #[serde(rename = "nts_f64")]
    F64,
    #[serde(rename = "nts_llvm")]
    Llvm,
    #[serde(rename = "nts_jvm")]
    Jvm,
}

impl Column {
    pub(super) fn index(self) -> usize {
        match self {
            Self::C => 0,
            Self::F64 => 1,
            Self::Llvm => 3,
            Self::Jvm => 4,
        }
    }
    pub(super) fn from_generated(generated: crate::Generated) -> Option<Self> {
        match generated {
            crate::Generated::Specialized => Some(Self::C),
            crate::Generated::Unspecialized => Some(Self::F64),
            crate::Generated::Llvm => Some(Self::Llvm),
            crate::Generated::Jvm => Some(Self::Jvm),
            crate::Generated::None | crate::Generated::JavaReference => None,
        }
    }

    pub(super) fn key(self) -> &'static str {
        match self {
            Self::C => "nts_c",
            Self::F64 => "nts_f64",
            Self::Llvm => "nts_llvm",
            Self::Jvm => "nts_jvm",
        }
    }
}

/// One counted run: the child's output and the user instructions perf
/// counted inside its enable/disable bracket.
pub(super) struct Counted {
    pub(super) output: std::process::Output,
    pub(super) instructions: u64,
}

/// The CPU a counted run pins to: any allowed CPU outside the measurement
/// pair 4–5, preferring a performance core (the `cpu_core` PMU the count
/// names). Instruction counts need no quiet core, so counted runs never
/// take the measurement lock.
pub(super) fn count_cpu() -> Result<u32> {
    let status = std::fs::read_to_string("/proc/self/status")
        .context("reading inherited affinity for counted runs")?;
    let allowed = status
        .lines()
        .find_map(|line| line.strip_prefix("Cpus_allowed_list:"))
        .context("/proc/self/status names no inherited CPU set")?;
    let mut cpus = Vec::new();
    for part in allowed.trim().split(',') {
        match part.split_once('-') {
            Some((lo, hi)) => {
                let lo: u32 = lo.trim().parse().context("CPU list")?;
                let hi: u32 = hi.trim().parse().context("CPU list")?;
                cpus.extend(lo..=hi);
            }
            None => cpus.push(part.trim().parse::<u32>().context("CPU list")?),
        }
    }
    let free: Vec<u32> = cpus
        .into_iter()
        .filter(|cpu| ![4, 5].contains(cpu))
        .collect();
    free.iter()
        .copied()
        .find(|cpu| *cpu < 16)
        .or_else(|| free.first().copied())
        .context("no CPU outside the measurement pair 4-5 is allowed")
}

/// Raw counted instructions in perf's CSV: the one active PMU's row, fully
/// run. An inactive hybrid sibling reads `<not counted>` at 0% and is not
/// a zero.
fn counted_instructions(csv: &str) -> Result<u64> {
    let mut active: Vec<u64> = Vec::new();
    for line in csv.lines() {
        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        if fields.len() < 5 || !fields[2].contains("/instructions/") {
            continue;
        }
        if fields[0] == "<not counted>" {
            ensure!(
                fields[4].parse::<f64>().is_ok_and(|percent| percent == 0.0),
                "instructions counter did not run"
            );
            continue;
        }
        let percent: f64 = fields[4].parse().context("counter running percentage")?;
        ensure!(
            (99.0..=100.0).contains(&percent),
            "instructions counter was multiplexed"
        );
        active.push(fields[0].parse().context("instructions counter value")?);
    }
    ensure!(active.len() == 1, "instructions must run on one pinned PMU");
    Ok(active[0])
}

/// Run `command` pinned to `cpu`, counting user instructions inside the
/// perf FIFO bracket the common drivers open (`--control`): the counted
/// driver's enable/disable owns the window, so startup and warmup stay
/// outside the count. The FIFOs are held open here so neither perf nor
/// the driver blocks opening its end.
pub(super) fn spawn_counted(
    command: &std::process::Command,
    cpu: u32,
    dir: &std::path::Path,
) -> Result<Counted> {
    std::fs::create_dir_all(dir).context("creating the counted run directory")?;
    let control = dir.join("control");
    let acknowledgement = dir.join("ack");
    let perf_csv = dir.join("perf.csv");
    for fifo in [&control, &acknowledgement] {
        // A previous counted run's FIFOs are this run's to replace.
        let _ = std::fs::remove_file(fifo);
        let made = std::process::Command::new("mkfifo")
            .arg(fifo)
            .status()
            .context("making perf control FIFOs")?;
        ensure!(made.success(), "mkfifo failed for {}", fifo.display());
    }
    let held: Vec<std::fs::File> = [&control, &acknowledgement]
        .iter()
        .map(|fifo| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(fifo)
                .context("holding perf control FIFOs open")
        })
        .collect::<Result<_>>()?;

    let event = if cpu < 16 {
        "cpu_core/instructions/u"
    } else {
        "instructions:u"
    };
    let mut perf = std::process::Command::new("timeout");
    perf.args([
        "-k",
        "5",
        "120",
        "perf",
        "stat",
        "-D",
        "-1",
        "--control",
        &format!("fifo:{},{}", control.display(), acknowledgement.display()),
        "-x,",
        "-o",
    ])
    .arg(&perf_csv)
    .args(["-e", event, "--", "taskset", "-c"])
    .arg(cpu.to_string())
    .arg(command.get_program())
    .args(command.get_args())
    .env("NTS_BENCH_COUNT_CONTROL", &control)
    .env("NTS_BENCH_COUNT_ACK", &acknowledgement);
    for (key, value) in command.get_envs() {
        match value {
            Some(value) => {
                perf.env(key, value);
            }
            None => {
                perf.env_remove(key);
            }
        }
    }
    if let Some(dir) = command.get_current_dir() {
        perf.current_dir(dir);
    }
    let output = perf.output().context("running a counted benchmark")?;
    drop(held);
    let csv = std::fs::read_to_string(&perf_csv).context("reading perf's counted output")?;
    Ok(Counted {
        instructions: counted_instructions(&csv)?,
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_failure_retains_the_exit_and_exact_stderr() -> Result<()> {
        let mut command = std::process::Command::new("node");
        command.args([
            "-e",
            "process.stderr.write('nts: refused: example\\n'); process.exit(7)",
        ]);
        let error = crate::measure_once(&mut command)
            .err()
            .context("child failure was accepted")?;
        let expected = Outcome::RuntimeAbort {
            termination: Termination::Exit { code: 7 },
            stderr: "nts: refused: example\n".to_owned(),
        };
        assert_eq!(error.downcast_ref::<Outcome>(), Some(&expected));
        assert_eq!(
            serde_json::from_str::<Outcome>(&serde_json::to_string(&expected)?)?,
            expected
        );
        let launch = crate::measure_once(&mut std::process::Command::new(
            "/nts-missing-benchmark-tool",
        ))
        .err()
        .context("a missing tool was accepted")?;
        assert!(
            launch.downcast_ref::<Outcome>().is_none(),
            "tool failure is not a program outcome"
        );
        let mut observations = std::collections::BTreeMap::new();
        assert!(
            crate::observe(
                Err(launch),
                crate::Generated::Specialized,
                &mut observations
            )
            .is_err()
        );
        assert!(
            crate::observe(
                Err(anyhow::anyhow!("clang: failed to compile")),
                crate::Generated::Llvm,
                &mut observations
            )
            .is_err()
        );
        assert!(
            observations.is_empty(),
            "instrument failures are never recorded as runtime aborts"
        );
        assert!(serde_json::from_str::<Outcome>(r#"{"kind":"runtime-abort","termination":{"kind":"exit","code":7},"stderr":"x","unknown":0}"#).is_err());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn a_signal_is_distinct_from_an_exit_code() -> Result<()> {
        use std::os::unix::process::ExitStatusExt;
        let output = std::process::Output {
            status: std::process::ExitStatus::from_raw(6),
            stdout: vec![],
            stderr: b"nts: refused\n".to_vec(),
        };
        assert_eq!(
            Outcome::of(&output)?,
            Outcome::RuntimeAbort {
                termination: Termination::Signal { signal: 6 },
                stderr: "nts: refused\n".to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn counted_instructions_read_the_one_active_pmu() -> Result<()> {
        let csv = "<not counted>,,cpu_atom/instructions/u,0,0.00,,\n319719383,,cpu_core/instructions/u,20645101,100.00,,\n";
        assert_eq!(counted_instructions(csv)?, 319_719_383);
        assert!(counted_instructions("5,,cpu_core/instructions/u,10,50.00,,\n").is_err());
        assert!(counted_instructions("no counters here\n").is_err());
        Ok(())
    }

    #[test]
    fn the_count_cpu_is_never_a_measurement_cpu() -> Result<()> {
        assert!(![4, 5].contains(&count_cpu()?));
        Ok(())
    }
}
