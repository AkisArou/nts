//! Gate-only observations of standalone check and emit commands, never a verdict input.
//! Linux CPU counters are process-wide and include waited children separately.
//! getrusage reports microseconds; an unavailable observation stays unknown.
//! `VmHWM` is the standalone process's lifetime self peak in KiB, excluding
//! children. It is read once at check completion; child peaks remain unknown.

use std::cell::RefCell;
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}
static CASES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn project_context() -> Option<String> {
    CONTEXT.with_borrow(|context| context.as_ref().map(|value| value.project.clone()))
}

#[derive(Debug)]
struct Context {
    file: std::fs::File,
    record: Vec<u8>,
    project: String,
    step: String,
    failed: bool,
}

#[derive(Debug)]
struct Sample {
    at: Instant,
    epoch: f64,
    cpu: Option<[f64; 4]>,
}

#[cfg(unix)]
fn cpu() -> Option<[f64; 4]> {
    use nix::sys::resource::{UsageWho, getrusage};
    let own = getrusage(UsageWho::RUSAGE_SELF).ok()?;
    let children = getrusage(UsageWho::RUSAGE_CHILDREN).ok()?;
    let seconds = |time: nix::sys::time::TimeVal| {
        #[allow(
            clippy::cast_precision_loss,
            reason = "getrusage seconds fit an f64 for process lifetimes"
        )]
        {
            time.tv_sec() as f64 + time.tv_usec() as f64 / 1_000_000.0
        }
    };
    Some([
        seconds(own.user_time()),
        seconds(own.system_time()),
        seconds(children.user_time()),
        seconds(children.system_time()),
    ])
}

#[cfg(not(unix))]
fn cpu() -> Option<[f64; 4]> {
    None
}

fn sample() -> Sample {
    Sample {
        at: Instant::now(),
        epoch: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64(),
        cpu: cpu(),
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_peak_rss_kb(status: &str) -> Option<u64> {
    let fields: Vec<_> = status
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))?
        .split_whitespace()
        .collect();
    match fields.as_slice() {
        [value, "kB"] => value.parse().ok(),
        _ => None,
    }
}

fn self_peak_rss_kb() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        parse_peak_rss_kb(&std::fs::read_to_string("/proc/self/status").ok()?)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

pub(crate) fn event(mut value: serde_json::Value) {
    CONTEXT.with_borrow_mut(|context| {
        if let Some(context) = context.as_mut().filter(|context| !context.failed) {
            // One file has one context. Readers take identity and resolution
            // from its case header; phases carry only their own observations.
            if value["event"] == "case" {
                value["project"] = context.project.clone().into();
                value["step"] = context.step.clone().into();
                value["pid"] = std::process::id().into();
                value["version"] = 2.into();
                value["cpu_measure"] = "getrusage-v1".into();
                value["cpu_resolution_s"] = 0.000_001.into();
            }
            // An unavailable/full metrics directory must never change the
            // command's output or status. The runner reports missing/partial
            // timing records independently from the product verdict.
            // Display writes JSON punctuation separately. Serialize into the
            // session's buffer, then publish each complete event immediately:
            // an abort must not lose the last observed phase to a later flush.
            context.record.clear();
            if serde_json::to_writer(&mut context.record, &value).is_err() {
                context.failed = true;
                return;
            }
            context.record.push(b'\n');
            if context.file.write_all(&context.record).is_err() {
                context.failed = true;
            }
        }
    });
}

#[derive(Debug)]
pub struct Span(Option<(&'static str, Sample)>);

pub fn span(name: &'static str) -> Span {
    let enabled =
        CONTEXT.with_borrow(|context| context.as_ref().is_some_and(|context| !context.failed));
    let sample = enabled.then(sample);
    if let Some(start) = &sample {
        event(serde_json::json!({"event":"begin", "phase":name, "epoch":start.epoch}));
    }
    Span(sample.map(|start| (name, start)))
}

impl Drop for Span {
    fn drop(&mut self) {
        if let Some((name, start)) = &self.0 {
            let end = sample();
            let delta = start
                .cpu
                .zip(end.cpu)
                .map(|(start, end)| std::array::from_fn::<_, 4, _>(|i| end[i] - start[i]));
            let mut record = serde_json::json!({"event":"end", "phase":name,
                "epoch":end.epoch, "start_epoch":start.epoch,
                "wall_s":end.at.duration_since(start.at).as_secs_f64(),
                "self_user_s":delta.map(|d| d[0]), "self_sys_s":delta.map(|d| d[1]),
                "child_user_s":delta.map(|d| d[2]), "child_sys_s":delta.map(|d| d[3])});
            if *name == "check.total" {
                record["self_peak_rss_kb"] = self_peak_rss_kb().into();
                record["child_peak_rss_kb"] = serde_json::Value::Null;
            }
            event(record);
        }
    }
}

pub fn measure<T>(name: &'static str, work: impl FnOnce() -> T) -> T {
    let _span = span(name);
    work()
}

pub(crate) fn child<E>(
    name: &'static str,
    work: impl FnOnce() -> Result<std::process::Output, E>,
) -> Result<std::process::Output, E> {
    let _span = span(name);
    let result = work();
    if let Ok(output) = &result {
        child_result(name, output);
    }
    result
}

pub(crate) fn child_result(name: &'static str, output: &std::process::Output) {
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt as _;
        output.status.signal()
    };
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    event(serde_json::json!({"event":"child.result", "phase":name,
            "exit":output.status.code(), "signal":signal,
            "stdout_bytes":output.stdout.len(), "stderr_bytes":output.stderr.len()}));
}

#[derive(Debug)]
pub struct Session {
    total: Option<Span>,
    previous: Option<Context>,
}

pub fn session(project: &camino::Utf8Path) -> Session {
    // Unit tests may run many checks concurrently in one process. Its
    // process-wide CPU counters cannot attribute those to individual tests.
    // Gate CLI children each execute one check and have unambiguous counters.
    if !matches!(
        std::env::args().nth(1).as_deref(),
        Some("check" | "emit-c" | "emit-llvm" | "emit-jvm")
    ) {
        return Session {
            total: None,
            previous: None,
        };
    }
    match (
        std::env::var("NTS_GATE_CASE_COSTS_DIR"),
        std::env::var("NTS_GATE_STEP"),
    ) {
        (Ok(root), Ok(step)) => session_at(std::path::Path::new(&root), project, step),
        _ => Session {
            total: None,
            previous: None,
        },
    }
}

fn session_at(root: &std::path::Path, project: &camino::Utf8Path, step: String) -> Session {
    let opened = || {
        std::fs::create_dir_all(root).ok()?;
        let path = root.join(format!(
            "check-{}-{}.jsonl",
            std::process::id(),
            CASES.fetch_add(1, Ordering::Relaxed)
        ));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .ok()?;
        Some(Context {
            file,
            record: Vec::new(),
            project: project.to_string(),
            step,
            failed: false,
        })
    };
    let Some(context) = opened() else {
        return Session {
            total: None,
            previous: None,
        };
    };
    let previous = CONTEXT.with_borrow_mut(|current| current.replace(context));
    event(
        serde_json::json!({"event":"case", "observation":std::env::var("NTS_GATE_COMPILER_OBSERVATION").unwrap_or_default(), "binary_sha":std::env::var("NTS_GATE_CASE_BINARY_SHA").unwrap_or_default(), "backend":std::env::var("NTS_BACKEND").unwrap_or_else(|_| "c".into()),
        "rc":std::env::var("NTS_RC").unwrap_or_else(|_| "0".into())}),
    );
    Session {
        total: Some(span("check.total")),
        previous,
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.total.is_some() {
            drop(self.total.take());
            CONTEXT.with_borrow_mut(|context| *context = self.previous.take());
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "test assertions")]
mod tests {
    use super::*;

    #[test]
    fn peak_rss_requires_a_kernel_value_and_its_unit() {
        assert_eq!(
            parse_peak_rss_kb("Name:\tnts\nVmHWM:\t 12345 kB\nVmRSS:\t1 kB"),
            Some(12345)
        );
        for status in [
            "",
            "VmRSS: 12345 kB",
            "VmHWM: unknown kB",
            "VmHWM: 12345",
            "VmHWM: 12345 MB",
            "VmHWM: 12345 kB extra",
        ] {
            assert_eq!(parse_peak_rss_kb(status), None, "{status}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn observations_keep_an_actual_childs_output_and_nonzero_status() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-case-costs-output");
        let session = session_at(&root, camino::Utf8Path::new("fixture"), "examples".into());
        let output = child("oracle.execute", || {
            std::process::Command::new("sh")
                .args(["-c", "printf original; exit 7"])
                .output()
        })
        .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stdout, b"original");
        let path = std::fs::read_dir(&root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let published = std::fs::read_to_string(&path).unwrap();
        assert!(published.ends_with('\n'));
        assert!(
            published.lines().any(|line| {
                let row: serde_json::Value = serde_json::from_str(line).unwrap();
                row["event"] == "child.result" && row["exit"] == 7
            }),
            "a complete event is visible before the session is dropped"
        );
        drop(session);
        let rows: Vec<serde_json::Value> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(rows[0]["project"], "fixture");
        assert_eq!(rows[0]["cpu_measure"], "getrusage-v1");
        assert!(rows[1..].iter().all(|row| row.get("project").is_none()));
        assert!(
            rows.iter()
                .any(|row| row["event"] == "child.result" && row["exit"] == 7)
        );
        assert!(
            rows.iter()
                .any(|row| row["event"] == "end" && row["phase"] == "check.total")
        );
        let total = rows
            .iter()
            .find(|row| row["event"] == "end" && row["phase"] == "check.total")
            .unwrap();
        #[cfg(target_os = "linux")]
        assert!(total["self_peak_rss_kb"].as_u64().is_some_and(|kb| kb > 0));
        #[cfg(not(target_os = "linux"))]
        assert!(total["self_peak_rss_kb"].is_null());
        assert_eq!(
            total.get("child_peak_rss_kb"),
            Some(&serde_json::Value::Null)
        );
        assert!(
            rows.iter()
                .filter(|row| row["phase"] != "check.total" || row["event"] != "end")
                .all(|row| row.get("self_peak_rss_kb").is_none())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_metrics_output_preserves_the_work_and_error() {
        let path = crate::scratch::StdScratchDir::path_in_std_target("nts-case-costs-file");
        std::fs::write(&path, "not a directory").unwrap();
        let _session = session_at(&path, camino::Utf8Path::new("test"), "examples".into());
        assert_eq!(measure("unchanged", || 27), 27);
        assert_eq!(
            child("failed-child", || Err::<std::process::Output, _>(
                "original failure"
            ))
            .unwrap_err(),
            "original failure"
        );
        std::fs::remove_file(path).unwrap();
    }
}
