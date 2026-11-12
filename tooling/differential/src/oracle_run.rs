//! Node uses the same owned-group CPU/progress supervisor as compiled arms.
use anyhow::{Context as _, Result, ensure};
use camino::Utf8Path;
use serde_json::{Value, json};
use std::process::{Command, Output};
use std::time::Duration;

pub(super) struct Finished {
    pub(super) output: Output,
    pub(super) status: Value,
    /// The most the oracle's own resident scope held: a measurement, kept
    /// beside the status, never in it, so no answer, identity or shadow
    /// differs between two runs of one oracle by it.
    pub(super) resident_peak_bytes: Option<u64>,
}

#[derive(Debug)]
pub(crate) struct ResidentPressure(pub(crate) String);
impl std::fmt::Display for ResidentPressure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for ResidentPressure {}

fn output_bytes(value: &Value) -> Result<Vec<u8>> {
    let text = value.as_str().context("oracle raw output is missing")?;
    ensure!(
        text.len() % 2 == 0,
        "oracle raw output has an incomplete byte"
    );
    let nibble = |byte: u8| -> Result<u8> {
        match byte {
            b'0'..=b'9' => Ok(byte - b'0'),
            b'a'..=b'f' => Ok(byte - b'a' + 10),
            _ => anyhow::bail!("oracle raw output has an invalid hex digit"),
        }
    };
    text.as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| Ok((nibble(pair[0])? << 4) | nibble(pair[1])?))
        .collect()
}

/// Both callers use the same census-backed launcher and the same policy file.
/// The outer observer guards the instrument; only the launcher prices Node.
pub(super) fn execute(command: &Command, source: &Utf8Path) -> Result<Finished> {
    let root = source_root()?;
    let population = super::oracle_coverage::root_and_source(source)
        .map_or_else(|| source.as_str().to_owned(), |(_, source)| source);
    execute_owned(command, Utf8Path::new(&population), &root)
}

pub(super) fn execution_identity() -> Result<String> {
    Ok(super::oracle_emit::digest(&serde_json::to_vec(&[
        super::oracle_emit::digest(include_bytes!("../oracle-execution.ts")),
        super::oracle_emit::digest(include_bytes!("../oracle-execution-policy.ts")),
        super::oracle_emit::digest(include_bytes!("../oracle-batch.ts")),
    ])?))
}

fn source_root() -> Result<camino::Utf8PathBuf> {
    let raw = std::env::var("NTS_ORACLE_DEPENDENCIES")
        .context("oracle has no owned dependency capability")?;
    let capability: Value = serde_json::from_str(&raw)?;
    Ok(camino::Utf8PathBuf::from(
        capability["source"]
            .as_str()
            .context("oracle has no source root")?,
    ))
}

pub(super) fn prepare(request: &Value) -> Result<Value> {
    let result = request_owned("--prepare", request, &source_root()?)?;
    if !result["budget"].is_null() {
        return Err(super::oracle_coverage::BudgetExceeded {
            budget: result["budget"].clone(),
            recorded: false,
        }
        .into());
    }
    ensure!(
        result["prepared"].is_object(),
        "oracle preparation returned no snapshot"
    );
    Ok(result["prepared"].clone())
}

fn execute_owned(command: &Command, source: &Utf8Path, root: &Utf8Path) -> Result<Finished> {
    let text = |value: &std::ffi::OsStr| {
        value
            .to_str()
            .map(str::to_owned)
            .context("oracle command is not UTF-8")
    };
    let request = json!({"source":source,"command":text(command.get_program())?,
        "args":command.get_args().map(text).collect::<Result<Vec<_>>>()?,
        "cwd":command.get_current_dir(),
        "env":command.get_envs().map(|(key,value)|Ok((text(key)?,value.map(text).transpose()?))).collect::<Result<Vec<_>>>()?});
    let result = request_owned("--run", &request, root)?;
    let run = &result["run"];
    ensure!(
        run["error"].is_null(),
        "oracle execution held: {}",
        run["error"]
    );
    let stop = ["hung", "runaway"].into_iter().find_map(|kind| {
        run[kind]
            .as_str()
            .map(|reason| json!({"kind":kind,"reason":reason}))
    });
    let code = run["status"].as_i64();
    let signal = run["signal"].as_str();
    #[cfg(unix)]
    let status = {
        use std::os::unix::process::ExitStatusExt as _;
        let raw = if let Some(code) = code {
            i32::try_from(code)? << 8
        } else {
            match signal {
                Some("SIGKILL") => 9,
                Some("SIGTERM") => 15,
                Some("SIGABRT") => 6,
                _ => anyhow::bail!("oracle execution has no valid exit status: {run}"),
            }
        };
        std::process::ExitStatus::from_raw(raw)
    };
    #[cfg(not(unix))]
    let status = {
        use std::os::windows::process::ExitStatusExt as _;
        std::process::ExitStatus::from_raw(u32::try_from(
            code.context("oracle execution has no status")?,
        )?)
    };
    Ok(Finished {
        output: Output {
            status,
            stdout: output_bytes(&result["stdoutHex"])?,
            stderr: output_bytes(&result["stderrHex"])?,
        },
        status: json!({"version":2,"exit_code":code,"signal":signal,"stop":stop,
            "budget":result["budget"],"cpu_limit_s":result["limits"]["cpuSeconds"],"resident_limit_bytes":result["limits"]["residentBytes"]}),
        resident_peak_bytes: result["residentPeakBytes"].as_u64(),
    })
}

fn request_owned(mode: &str, request: &Value, root: &Utf8Path) -> Result<Value> {
    let helper = root.join("tooling/differential/oracle-execution.ts");
    ensure!(
        root.is_absolute() && std::fs::read(&helper)? == include_bytes!("../oracle-execution.ts"),
        "oracle execution helper identity changed"
    );
    ensure!(
        std::fs::read(root.join("tooling/differential/oracle-execution-policy.ts"))?
            == include_bytes!("../oracle-execution-policy.ts"),
        "oracle execution policy identity changed"
    );
    if mode == "--prepare" {
        ensure!(
            std::fs::read(root.join("tooling/differential/oracle-batch.ts"))?
                == include_bytes!("../oracle-batch.ts"),
            "oracle preparation helper identity changed"
        );
    }
    if mode == "--prepare" {
        super::oracle_emit::verify_source(&root.join("tooling/differential"))?;
    }
    let mut launcher = Command::new("node");
    launcher
        .arg(helper)
        .arg(mode)
        .arg(serde_json::to_string(&request)?);
    let observed = super::call_activity::command(
        launcher,
        super::call_activity::Limits {
            cpu_seconds: super::call_activity::COMMAND_CPU_BUDGET_SECONDS,
            idle: Duration::from_millis(super::oracle_coverage::IDLE_MILLIS),
        },
    )?;
    ensure!(
        observed.output.status.success() && observed.incomplete.is_none(),
        "oracle execution instrument did not finish: {:?}: {}",
        observed.incomplete,
        String::from_utf8_lossy(&observed.output.stderr)
    );
    let result: Value = serde_json::from_slice(&observed.output.stdout)
        .context("oracle execution result is unreadable")?;
    if result["instrument"]["kind"] == "memory-pressure" {
        return Err(ResidentPressure(
            result["instrument"]["reason"]
                .as_str()
                .context("oracle pressure reason is missing")?
                .to_owned(),
        )
        .into());
    }
    ensure!(
        result.get("instrument").is_none(),
        "oracle execution held: {}",
        result["instrument"]
    );
    Ok(result)
}

pub(super) fn run(command: Command, idle: Duration) -> Result<Finished> {
    let finished = super::call_activity::command(
        command,
        super::call_activity::Limits {
            cpu_seconds: super::call_activity::COMMAND_CPU_BUDGET_SECONDS,
            idle,
        },
    )?;
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt as _;
        finished.output.status.signal()
    };
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    let status = json!({"version":2,"exit_code":finished.output.status.code(),"signal":signal,
        "stop":finished.incomplete,"cpu_limit_s":super::call_activity::COMMAND_CPU_BUDGET_SECONDS,"idle_limit_ms":idle.as_millis()});
    Ok(Finished {
        output: finished.output,
        status,
        resident_peak_bytes: None,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn preparation_inside_the_tests_step_asks_the_host_for_no_memory() {
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let output = crate::self_test::run_through(
            "source_contracts::tests::unavailable_bindings_do_not_compare_unexecuted_module_output",
            |test| {
                let argv: Vec<_> = std::iter::once(test.get_program())
                    .chain(test.get_args())
                    .map(|arg| arg.to_str().expect("UTF-8 test argv"))
                    .collect();
                let mut command = Command::new("node");
                command
                    .arg(root.join("tooling/differential/oracle-reservation-fixture.ts"))
                    .arg(serde_json::to_string(&argv).unwrap());
                command
            },
        );
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("\"step\":\"PASS\""));
    }

    #[test]
    fn the_native_launch_uses_the_shared_population_policy_and_resident_scope() {
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        // Started as every oracle child is: with the toolchain's heap flags.
        let toolchain: Value =
            serde_json::from_str(include_str!("../oracle-toolchain.json")).unwrap();
        let heap: Vec<&str> = toolchain["execution"]["args"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .filter(|flag| flag.starts_with("--max-"))
            .collect();
        assert_eq!(heap.len(), 2, "the toolchain sets the oracle's heap");
        for (source, cpu) in [
            ("benchmarks/cases/private/case.ts", 60),
            ("tests/programs/private/main.ts", 15),
        ] {
            let mut command = Command::new("node");
            command.args(&heap).args(["-e","const m=new WebAssembly.Memory({initial:1,maximum:65536});process.stdout.write(Buffer.from([0,255,128]));process.stderr.write(Buffer.from([254,0]))"]);
            let result = execute_owned(&command, Utf8Path::new(source), &root).unwrap();
            assert!(
                result.output.status.success(),
                "{}",
                String::from_utf8_lossy(&result.output.stderr)
            );
            assert_eq!(result.output.stdout, [0, 255, 128]);
            assert_eq!(result.output.stderr, [254, 0]);
            assert_eq!(result.status["cpu_limit_s"], cpu);
            assert_eq!(
                result.status["resident_limit_bytes"],
                2_u64 * 1024 * 1024 * 1024
            );
            assert!(result.status["budget"].is_null());
        }
        // The control differs in one thing: no heap flags, which the shared launcher refuses.
        let mut bare = Command::new("node");
        bare.args(["-e", "process.exit(0)"]);
        let Err(refused) = execute_owned(
            &bare,
            Utf8Path::new("tests/programs/private/main.ts"),
            &root,
        ) else {
            panic!("an oracle child without the heap flags ran");
        };
        assert!(
            format!("{refused:#}").contains("oracle execution refused"),
            "{refused:#}"
        );
    }

    fn node(source: &str, cpu: u64) -> Command {
        let mut command = Command::new("prlimit");
        command.args([
            "--core=0",
            &format!("--cpu={cpu}:{}", cpu + 1),
            "node",
            "--input-type=module",
            "-e",
            source,
        ]);
        command
    }

    #[test]
    fn a_program_exit_124_is_not_our_guard() {
        let result = run(
            node("process.stdout.write('answered');process.exit(124)", 2),
            Duration::from_secs(120),
        )
        .unwrap();
        assert_eq!(result.status["exit_code"], 124);
        assert!(result.status["stop"].is_null());
        assert_eq!(result.output.stdout, b"answered");
    }

    #[test]
    fn our_idle_stop_is_recorded_independently() {
        let result = run(
            node("setTimeout(()=>{},60000)", 2),
            Duration::from_millis(50),
        )
        .unwrap();
        assert_eq!(result.status["stop"]["kind"], "hung");
        assert!(!result.status["signal"].is_null());
    }

    #[test]
    fn kernel_cpu_exhaustion_is_not_a_supervisor_stop() {
        let result = run(node("for(;;){}", 1), Duration::from_secs(120)).unwrap();
        assert!(result.status["stop"].is_null());
        assert!(!result.status["signal"].is_null());
    }
}
