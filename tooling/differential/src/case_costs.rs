//! Gate-only observations of a standalone `nts check`, never a verdict input.
//! Linux CPU counters are process-wide and include waited children separately.
//! Their tick resolution is recorded; unsupported hosts retain wall timings.

use std::cell::RefCell;
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}
static CASES: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
struct Context {
    file: std::fs::File,
    project: String,
    step: String,
    hz: Option<f64>,
    failed: bool,
}

#[derive(Debug)]
struct Sample {
    at: Instant,
    epoch: f64,
    cpu: Option<[f64; 4]>,
}

fn hz() -> Option<f64> {
    let width = std::mem::size_of::<usize>();
    let bytes = std::fs::read("/proc/self/auxv").ok()?;
    bytes.chunks_exact(width * 2).find_map(|pair| {
        let kind = usize::from_ne_bytes(pair[..width].try_into().ok()?);
        // Clock ticks are a small integer; reject an unsupported wide value.
        let value = usize::from_ne_bytes(pair[width..].try_into().ok()?);
        let value = f64::from(u32::try_from(value).ok()?);
        (kind == 17 && value > 0.0).then_some(value)
    })
}

fn cpu() -> Option<[f64; 4]> {
    let text = std::fs::read_to_string("/proc/self/stat").ok()?;
    let fields: Vec<_> = text
        .get(text.rfind(')')? + 2..)?
        .split_whitespace()
        .collect();
    Some([
        fields.get(11)?.parse().ok()?,
        fields.get(12)?.parse().ok()?,
        fields.get(13)?.parse().ok()?,
        fields.get(14)?.parse().ok()?,
    ])
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

pub(crate) fn event(mut value: serde_json::Value) {
    CONTEXT.with_borrow_mut(|context| {
        if let Some(context) = context.as_mut().filter(|context| !context.failed) {
            value["project"] = context.project.clone().into();
            value["step"] = context.step.clone().into();
            value["pid"] = std::process::id().into();
            value["cpu_resolution_s"] = context.hz.map(|hz| 1.0 / hz).into();
            // An unavailable/full metrics directory must never change the
            // command's output or status. The runner reports missing/partial
            // timing records independently from the product verdict.
            if writeln!(context.file, "{value}").is_err() {
                context.failed = true;
            }
        }
    });
}

#[derive(Debug)]
pub(crate) struct Span(Option<(&'static str, Sample)>);

pub(crate) fn span(name: &'static str) -> Span {
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
            let hz = CONTEXT.with_borrow(|context| context.as_ref().and_then(|context| context.hz));
            let delta = start.cpu.zip(end.cpu).zip(hz).map(|((start, end), hz)| {
                std::array::from_fn::<_, 4, _>(|i| (end[i] - start[i]) / hz)
            });
            event(serde_json::json!({"event":"end", "phase":name,
                "epoch":end.epoch, "start_epoch":start.epoch,
                "wall_s":end.at.duration_since(start.at).as_secs_f64(),
                "self_user_s":delta.map(|d| d[0]), "self_sys_s":delta.map(|d| d[1]),
                "child_user_s":delta.map(|d| d[2]), "child_sys_s":delta.map(|d| d[3])}));
        }
    }
}

pub(crate) fn measure<T>(name: &'static str, work: impl FnOnce() -> T) -> T {
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
    result
}

#[derive(Debug)]
pub(crate) struct Session {
    total: Option<Span>,
    previous: Option<Context>,
}

pub(crate) fn session(project: &camino::Utf8Path) -> Session {
    // Unit tests may run many checks concurrently in one process. Its
    // process-wide CPU counters cannot attribute those to individual tests.
    // Gate CLI children each execute one check and have unambiguous counters.
    if std::env::args().nth(1).as_deref() != Some("check") {
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
            project: project.to_string(),
            step,
            hz: hz(),
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
        serde_json::json!({"event":"case", "binary_sha":std::env::var("NTS_GATE_CASE_BINARY_SHA").unwrap_or_default(), "backend":std::env::var("NTS_BACKEND").unwrap_or_else(|_| "c".into()),
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
    #[cfg(unix)]
    fn observations_keep_an_actual_childs_output_and_nonzero_status() {
        let root =
            std::env::temp_dir().join(format!("nts-case-costs-output-{}", std::process::id()));
        let session = session_at(&root, camino::Utf8Path::new("fixture"), "examples".into());
        let output = child("oracle.execute", || {
            std::process::Command::new("sh")
                .args(["-c", "printf original; exit 7"])
                .output()
        })
        .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stdout, b"original");
        drop(session);
        let path = std::fs::read_dir(&root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let rows: Vec<serde_json::Value> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert!(
            rows.iter()
                .any(|row| row["event"] == "child.result" && row["exit"] == 7)
        );
        assert!(
            rows.iter()
                .any(|row| row["event"] == "end" && row["phase"] == "check.total")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_metrics_output_preserves_the_work_and_error() {
        let path = std::env::temp_dir().join(format!("nts-case-costs-file-{}", std::process::id()));
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
