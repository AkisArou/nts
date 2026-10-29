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
}
