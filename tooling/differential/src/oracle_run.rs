//! Supervise the child we own. Guard decisions are state here, never an exit
//! code guessed to mean timeout; the program may itself choose exit 124.
use std::io::Read;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

pub(super) struct Finished {
    pub(super) output: Output,
    pub(super) status: Value,
}

pub(super) fn run(mut command: Command, wall: Duration) -> Result<Finished> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("starting Node oracle")?;
    let stdout = child.stdout.take().context("oracle stdout pipe")?;
    let stderr = child.stderr.take().context("oracle stderr pipe")?;
    let collect = |mut pipe: Box<dyn Read + Send>| -> std::io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        pipe.read_to_end(&mut bytes)?;
        Ok(bytes)
    };
    let out = thread::spawn(move || collect(Box::new(stdout)));
    let err = thread::spawn(move || collect(Box::new(stderr)));
    let started = Instant::now();
    let mut wall_guard = false;
    let mut exit = None;
    loop {
        if exit.is_none() {
            exit = child.try_wait().context("polling Node oracle")?;
        }
        if exit.is_some() && out.is_finished() && err.is_finished() {
            break;
        }
        if !wall_guard && started.elapsed() >= wall {
            wall_guard = true;
            if exit.is_some() {
                // try_wait has reaped it: that number could already name a
                // different process. Never inspect or signal it afterwards.
                bail!(
                    "oracle not measured: exited child left its output open; refusing a stale process group"
                );
            }
            if !signal_owned_group(&mut child, read_group, send_group)? {
                bail!(
                    "oracle not measured: child exited before guard signalling; refusing a stale group"
                );
            }
        }
        thread::sleep(Duration::from_millis(5));
    }
    let exit = exit.context("oracle exit status")?;
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        exit.signal()
    };
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    let status = json!({"version":1,"exit_code":exit.code(),"signal":signal,
        "wall_guard_fired":wall_guard,"cpu_limit_s":super::oracle_coverage::CPU_SECONDS,
        "wall_limit_ms":wall.as_millis()});
    let stdout = out
        .join()
        .map_err(|_| anyhow::anyhow!("oracle stdout reader panicked"))??;
    let stderr = err
        .join()
        .map_err(|_| anyhow::anyhow!("oracle stderr reader panicked"))??;
    Ok(Finished {
        output: Output {
            status: exit,
            stdout,
            stderr,
        },
        status,
    })
}

fn validate_group(child: u32, group: u32, own_group: u32) -> Result<()> {
    anyhow::ensure!(
        group > 1 && group != own_group && group == child,
        "oracle not measured: refusing unowned process group {group} for child {child}"
    );
    Ok(())
}

fn signal_owned_group(
    child: &mut Child,
    group_of: impl Fn(u32) -> Result<u32>,
    signal: impl FnOnce(u32) -> Result<()>,
) -> Result<bool> {
    // The held Child caches its exit status. This check happens before any
    // numeric lookup, including when its PID has already been reused.
    if child.try_wait()?.is_some() {
        return Ok(false);
    }
    let pid = child.id();
    let group = group_of(pid)?;
    let own_group = group_of(std::process::id())?;
    validate_group(pid, group, own_group)?;
    // A concurrently exiting, unreaped child still owns its PID. No other
    // thread owns this Child or can reap it between verification and signal.
    signal(group)?;
    Ok(true)
}

#[cfg(target_os = "linux")]
fn read_group(pid: u32) -> Result<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let end = stat.rfind(')').context("invalid process stat name")?;
    stat[end + 1..]
        .split_whitespace()
        .nth(2)
        .context("missing process group")?
        .parse()
        .context("invalid process group")
}

#[cfg(not(target_os = "linux"))]
fn read_group(_pid: u32) -> Result<u32> {
    bail!("oracle process-group verification requires Linux procfs")
}

fn send_group(group: u32) -> Result<()> {
    let status = Command::new("kill")
        .args(["-KILL", "--", &format!("-{group}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    anyhow::ensure!(
        status.success(),
        "oracle not measured: could not stop its owned process group"
    );
    Ok(())
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
    fn group_identity_must_be_safe_and_equal_the_child_pid() {
        for (child, group, own) in [(0, 0, 12), (1, 1, 12), (42, 42, 42), (42, 99, 12)] {
            assert!(validate_group(child, group, own).is_err());
        }
        validate_group(42, 42, 12).unwrap();
    }

    #[test]
    fn a_reaped_child_never_looks_up_or_signals_a_reused_pid() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let mut child = Command::new("sh").args(["-c", "exit 0"]).spawn().unwrap();
        child.wait().unwrap();
        let lookups = AtomicUsize::new(0);
        let signals = AtomicUsize::new(0);
        let sent = signal_owned_group(
            &mut child,
            |pid| {
                lookups.fetch_add(1, Ordering::SeqCst);
                Ok(pid)
            },
            |_| {
                signals.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .unwrap();
        assert!(!sent);
        assert_eq!(lookups.load(Ordering::SeqCst), 0);
        assert_eq!(signals.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_program_exit_124_is_not_our_guard() {
        let result = run(
            node("process.stdout.write('answered');process.exit(124)", 2),
            Duration::from_secs(120),
        )
        .unwrap();
        assert_eq!(result.status["exit_code"], 124);
        assert_eq!(result.status["wall_guard_fired"], false);
        assert_eq!(result.output.stdout, b"answered");
    }

    #[test]
    fn our_wall_kill_is_recorded_independently() {
        let result = run(
            node("setTimeout(()=>{},60000)", 2),
            Duration::from_millis(50),
        )
        .unwrap();
        assert_eq!(result.status["wall_guard_fired"], true);
        assert!(!result.status["signal"].is_null());
    }

    #[test]
    fn cpu_exhaustion_is_not_a_wall_expiry() {
        let result = run(node("for(;;){}", 1), Duration::from_secs(120)).unwrap();
        assert_eq!(result.status["wall_guard_fired"], false);
        assert!(!result.status["signal"].is_null());
    }
}
