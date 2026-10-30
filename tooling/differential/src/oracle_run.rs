//! Node uses the same owned-group CPU/progress supervisor as compiled arms.
use anyhow::Result;
use serde_json::{Value, json};
use std::process::{Command, Output};
use std::time::Duration;

pub(super) struct Finished {
    pub(super) output: Output,
    pub(super) status: Value,
}

pub(super) fn run(command: Command, idle: Duration) -> Result<Finished> {
    let finished = super::call_activity::command(
        command,
        super::call_activity::Limits {
            cpu_seconds: Duration::from_secs(super::oracle_coverage::CPU_SECONDS).as_secs_f64(),
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
        "stop":finished.incomplete,"cpu_limit_s":super::oracle_coverage::CPU_SECONDS,"idle_limit_ms":idle.as_millis()});
    Ok(Finished {
        output: finished.output,
        status,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

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
