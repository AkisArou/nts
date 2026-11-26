//! Gate-only observations of standalone check and emit commands, never a verdict input.
//! Linux CPU counters are process-wide and include waited children separately.
//! getrusage reports microseconds; an unavailable observation stays unknown.
//! `VmHWM` is the standalone process's lifetime self peak in KiB, excluding
//! children. It is read once at check completion; child peaks remain unknown.

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[path = "check_transport.rs"]
#[cfg(unix)]
mod transport;

#[derive(Debug)]
enum Destination {
    File(std::fs::File),
    #[cfg(unix)]
    Channel {
        output: transport::Nonblocking<std::os::unix::net::UnixStream>,
        active: usize,
    },
}
impl Write for Destination {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::File(file) => file.write(bytes),
            #[cfg(unix)]
            Self::Channel { output, .. } => {
                output.record(bytes)?;
                Ok(bytes.len())
            }
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}
static CASES: AtomicU64 = AtomicU64::new(0);
type ProcessFile = Arc<Mutex<ProcessOutput<Destination>>>;
static FILES: LazyLock<Mutex<HashMap<std::path::PathBuf, ProcessFile>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
struct ProcessOutput<W> {
    writer: W,
    failed: bool,
}

impl<W: Write> ProcessOutput<W> {
    fn write_record(&mut self, record: &[u8]) -> bool {
        if self.failed {
            return false;
        }
        // A partial write may leave an unfinished JSON row. No session may
        // append to that suffix, even if the underlying writer later recovers.
        self.failed = self.writer.write_all(record).is_err();
        !self.failed
    }

    #[cfg(any(unix, test))]
    fn finish_recording(
        &mut self,
        finish: impl FnOnce(&mut W) -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        if self.failed {
            return Err(std::io::Error::other(
                "check telemetry: output already failed",
            ));
        }
        let result = finish(&mut self.writer);
        self.failed = result.is_err();
        result
    }
}

fn process_file_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join(format!("check-{}.jsonl", std::process::id()))
}

// The first session exclusively creates the process's file. Later sessions
// borrow that acquired descriptor, never adopt an existing file by PID alone.
fn process_file(path: std::path::PathBuf) -> Option<ProcessFile> {
    let mut files = FILES.lock().ok()?;
    if let Some(file) = files.get(&path) {
        return Some(Arc::clone(file));
    }
    let file = std::fs::OpenOptions::new()
        .append(true)
        .create_new(true)
        .open(&path)
        .ok()?;
    let file = Arc::new(Mutex::new(ProcessOutput {
        writer: Destination::File(file),
        failed: false,
    }));
    files.insert(path, Arc::clone(&file));
    Some(file)
}

#[cfg(unix)]
fn process_channel(path: &std::path::Path, capability: &str, step: &str) -> Option<ProcessFile> {
    use std::io::Read;
    let acquire = || -> std::io::Result<ProcessFile> {
        let mut files = FILES
            .lock()
            .map_err(|_| std::io::Error::other("telemetry output lock poisoned"))?;
        if let Some(file) = files.get(path) {
            return Ok(Arc::clone(file));
        }
        // std's UnixStream opens with CLOEXEC. Acquire before starting the
        // session timer; no grandchild may inherit the drain's descriptor.
        // The runner is the peer and parent: acceptance, its acknowledgement
        // and EOF end setup; its drain or close ends the final flush. There is
        // no local wall deadline. A live runner which stops serving is a hang
        // covered by the ordinary step stall and process bounds, not missing
        // telemetry manufactured by a short timeout under machine load.
        let mut socket = std::os::unix::net::UnixStream::connect(path)?;
        let header = serde_json::to_vec(&serde_json::json!({"kind":"check.producer", "step":step,
            "pid":std::process::id(), "capability":capability}))?;
        let mut header = header;
        header.push(b'\n');
        socket.write_all(&header)?;
        let mut answer = [0; 6];
        socket.read_exact(&mut answer)?;
        if &answer != b"ready\n" {
            return Err(std::io::Error::other(
                "check telemetry: registration refused",
            ));
        }
        socket.set_nonblocking(true)?;
        let output = transport::Nonblocking::new(socket);
        let file = Arc::new(Mutex::new(ProcessOutput {
            writer: Destination::Channel { output, active: 0 },
            failed: false,
        }));
        files.insert(path.to_owned(), Arc::clone(&file));
        Ok(file)
    };
    match acquire() {
        Ok(file) => Some(file),
        Err(error) => {
            eprintln!(
                "check telemetry: channel {} unavailable: {error}",
                path.display()
            );
            None
        }
    }
}

pub(crate) fn project_context() -> Option<String> {
    CONTEXT.with_borrow(|context| context.as_ref().map(|value| value.project.clone()))
}

#[derive(Debug)]
struct Context {
    file: ProcessFile,
    session: u64,
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
            // A process appends all its sessions to one file. The session key
            // separates nested and concurrent contexts without repeating their
            // identity on every phase.
            value["session"] = context.session.into();
            if value["event"] == "case" {
                value["project"] = context.project.clone().into();
                value["step"] = context.step.clone().into();
                value["pid"] = std::process::id().into();
                value["version"] = 3.into();
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
            if !context
                .file
                .lock()
                .is_ok_and(|mut file| file.write_record(&context.record))
            {
                eprintln!("check telemetry: process output failed; observations are incomplete");
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
#[must_use = "keep the session guard until the observed command finishes"]
pub struct Session {
    total: Option<Span>,
    previous: Option<Context>,
}

pub fn session(project: &camino::Utf8Path) -> Session {
    // Unit tests may run many checks concurrently in one process. Its
    // process-wide CPU counters cannot attribute those to individual tests.
    // Gate CLI children each execute one check and have unambiguous counters.
    if !observed_command(
        std::env::args().nth(1).as_deref(),
        std::env::var("NTS_GATE_COMPILER_OBSERVATION")
            .ok()
            .as_deref(),
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
        (Ok(root), Ok(step)) => {
            #[cfg(unix)]
            if let Ok(channel) = std::env::var("NTS_GATE_CHECK_CHANNEL") {
                // A supplied channel never falls back to per-PID files.
                let capability = std::env::var("NTS_GATE_CHECK_CAPABILITY").unwrap_or_default();
                return channel_session(std::path::Path::new(&channel), &capability, project, step);
            }
            session_at(std::path::Path::new(&root), project, step)
        }
        _ => Session {
            total: None,
            previous: None,
        },
    }
}

#[cfg(unix)]
fn channel_session(
    path: &std::path::Path,
    capability: &str,
    project: &camino::Utf8Path,
    step: String,
) -> Session {
    match process_channel(path, capability, &step) {
        Some(file) => session_with_output(file, project, step),
        None => Session {
            total: None,
            previous: None,
        },
    }
}

fn observed_command(command: Option<&str>, observation: Option<&str>) -> bool {
    command == Some("check")
        || matches!(command, Some("emit-c" | "emit-llvm" | "emit-jvm"))
            && observation.is_some_and(|value| !value.is_empty())
}

fn session_at(root: &std::path::Path, project: &camino::Utf8Path, step: String) -> Session {
    let file = std::fs::create_dir_all(root)
        .ok()
        .and_then(|()| process_file(process_file_path(root)));
    match file {
        Some(file) => session_with_output(file, project, step),
        None => Session {
            total: None,
            previous: None,
        },
    }
}

fn session_with_output(file: ProcessFile, project: &camino::Utf8Path, step: String) -> Session {
    #[cfg(unix)]
    if let Ok(mut output) = file.lock()
        && let Destination::Channel { active, .. } = &mut output.writer
    {
        *active += 1;
    }
    let context = Context {
        file,
        session: CASES.fetch_add(1, Ordering::Relaxed),
        record: Vec::new(),
        project: project.to_string(),
        step,
        failed: false,
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
            let finished =
                CONTEXT.with_borrow_mut(|context| std::mem::replace(context, self.previous.take()));
            #[cfg(not(unix))]
            drop(finished);
            #[cfg(unix)]
            if let Some(context) = finished
                && let Ok(mut file) = context.file.lock()
            {
                let last = if let Destination::Channel { active, .. } = &mut file.writer {
                    *active -= 1;
                    *active == 0
                } else {
                    false
                };
                if last {
                    let result = file.finish_recording(|destination| {
                        if let Destination::Channel { output, .. } = destination {
                            // Every enclosing/concurrent total has stopped.
                            // Only this path may wait for backpressure.
                            output.writer.set_nonblocking(false)?;
                            let result = output.complete();
                            output.writer.set_nonblocking(true)?;
                            result
                        } else {
                            Ok(())
                        }
                    });
                    if let Err(error) = result {
                        eprintln!("check telemetry: final flush failed: {error}");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "test assertions")]
mod tests {
    use super::*;

    #[test]
    fn a_failed_final_flush_cannot_retry_a_partial_prefix_in_a_later_session() {
        let mut output = ProcessOutput {
            writer: Vec::new(),
            failed: false,
        };
        assert!(
            output
                .finish_recording(|bytes| {
                    bytes.extend_from_slice(b"partial");
                    Err(std::io::Error::other("injected final flush failure"))
                })
                .is_err()
        );
        let mut retried = false;
        assert!(
            output
                .finish_recording(|_| {
                    retried = true;
                    Ok(())
                })
                .is_err()
        );
        assert!(!retried);
        assert!(!output.write_record(b"next session\n"));
        assert_eq!(output.writer, b"partial");
    }

    #[cfg(unix)]
    #[test]
    fn a_supplied_broken_channel_is_named_and_never_creates_process_files() {
        const NAME: &str =
            "case_costs::tests::a_supplied_broken_channel_is_named_and_never_creates_process_files";
        if let Some(path) = std::env::var_os("NTS_TEST_BROKEN_CHECK_CHANNEL") {
            let session = channel_session(
                std::path::Path::new(&path),
                "capability",
                camino::Utf8Path::new("fixture"),
                "examples".into(),
            );
            assert!(session.total.is_none());
            return;
        }
        let root = crate::scratch::StdScratchDir::in_std_target("nts-broken-check-channel");
        let output = crate::self_test::run(NAME, |command| {
            command.env("NTS_TEST_BROKEN_CHECK_CHANNEL", root.join("absent.sock"));
        });
        assert!(String::from_utf8_lossy(&output.stderr).contains("check telemetry: channel"));
        assert_eq!(
            std::fs::read_dir(&root).unwrap().count(),
            0,
            "a broken supplied channel cannot create a fallback file"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn completed_phases_reach_the_kernel_before_the_total_finishes() {
        use std::io::{BufRead, BufReader};
        use std::os::fd::AsRawFd;
        use std::os::unix::net::{UnixListener, UnixStream};
        fn read_frame(reader: &mut BufReader<UnixStream>) -> serde_json::Value {
            let mut line = String::new();
            let count = reader.read_line(&mut line).unwrap_or_else(|error| {
                panic!(
                    "check telemetry wiring fixture hang guard: peer read did not complete: {error}"
                )
            });
            assert!(count > 0, "check telemetry wiring fixture: unexpected EOF");
            serde_json::from_str(&line).unwrap()
        }
        let root = crate::scratch::StdScratchDir::in_std_target("nts-check-channel-phases");
        let directory = std::fs::File::open(&root).unwrap();
        let path = std::path::PathBuf::from(format!(
            "/proc/{}/fd/{}/stream.sock",
            std::process::id(),
            directory.as_raw_fd()
        ));
        let listener = UnixListener::bind(&path).unwrap();
        std::thread::scope(|scope| {
            let (sent, seen) = std::sync::mpsc::channel();
            let reader = scope.spawn(move || {
                let (socket, _) = listener.accept().unwrap();
                // test-timing.ts selects .test.ts/.mjs and -fixture.ts/.mjs,
                // not Rust socket IO. This is only a wedged-fixture hang guard:
                // expiry panics by that name; all assertions wait for frames.
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(60)))
                    .unwrap();
                let mut reader = BufReader::new(socket);
                let header = read_frame(&mut reader);
                assert_eq!(header["kind"], "check.producer");
                reader.get_mut().write_all(b"ready\n").unwrap();
                let rows = (0..4).map(|_| read_frame(&mut reader)).collect::<Vec<_>>();
                assert_eq!(rows[3]["event"], "end");
                assert_eq!(rows[3]["phase"], "capture");
                sent.send(()).unwrap();
                let total = read_frame(&mut reader);
                assert_eq!(total["phase"], "check.total");
            });
            let session = channel_session(
                &path,
                "capability",
                camino::Utf8Path::new("fixture"),
                "examples".into(),
            );
            {
                let _phase = span("capture");
            }
            seen.recv().unwrap();
            assert!(
                session.total.is_some(),
                "completed capture was delivered before check.total stopped"
            );
            drop(session);
            reader.join().unwrap();
        });
    }

    #[test]
    fn emit_observations_need_the_case_workers_explicit_handoff() {
        assert!(observed_command(Some("check"), None));
        for command in ["emit-c", "emit-llvm", "emit-jvm"] {
            assert!(!observed_command(Some(command), None));
            assert!(!observed_command(Some(command), Some("")));
            assert!(observed_command(Some(command), Some("case-observation")));
        }
        assert!(!observed_command(Some("hir"), Some("case-observation")));
    }

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
    fn a_partial_write_disables_the_shared_output_for_every_session() {
        #[derive(Default)]
        struct RecoveringWriter {
            bytes: Vec<u8>,
            calls: usize,
        }
        impl Write for RecoveringWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.calls += 1;
                match self.calls {
                    1 => {
                        self.bytes.extend_from_slice(&bytes[..3]);
                        Ok(3)
                    }
                    2 => Err(std::io::Error::other("injected full disk")),
                    _ => {
                        self.bytes.extend_from_slice(bytes);
                        Ok(bytes.len())
                    }
                }
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let first = Arc::new(Mutex::new(ProcessOutput {
            writer: RecoveringWriter::default(),
            failed: false,
        }));
        let second = Arc::clone(&first);
        assert!(!first.lock().unwrap().write_record(b"first session\n"));
        assert!(!second.lock().unwrap().write_record(b"second session\n"));
        let output = first.lock().unwrap();
        assert!(output.failed);
        assert_eq!(output.writer.calls, 2, "no session retries a poisoned file");
        assert_eq!(output.writer.bytes, b"fir");
    }

    #[test]
    fn nested_and_parallel_sessions_share_one_process_file() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-case-costs-sessions");
        let outer = session_at(&root, camino::Utf8Path::new("outer"), "examples".into());
        {
            let _inner = session_at(&root, camino::Utf8Path::new("inner"), "examples".into());
            event(serde_json::json!({"event":"inner.observation"}));
        }
        event(serde_json::json!({"event":"outer.observation"}));
        std::thread::scope(|scope| {
            for project in ["parallel-a", "parallel-b"] {
                let root = &root;
                scope.spawn(move || {
                    let _session =
                        session_at(root, camino::Utf8Path::new(project), "examples".into());
                    event(serde_json::json!({"event":"parallel.observation"}));
                });
            }
        });
        drop(outer);
        let files: Vec<_> = std::fs::read_dir(&root).unwrap().collect();
        assert_eq!(files.len(), 1, "all sessions append to their process file");
        let path = process_file_path(&root);
        let rows: Vec<serde_json::Value> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let headers: Vec<_> = rows.iter().filter(|row| row["event"] == "case").collect();
        assert_eq!(headers.len(), 4);
        for header in headers {
            let session = header["session"].as_u64().unwrap();
            let owned: Vec<_> = rows
                .iter()
                .filter(|row| row["session"] == session)
                .collect();
            assert_eq!(owned.iter().filter(|row| row["event"] == "case").count(), 1);
            assert_eq!(
                owned
                    .iter()
                    .filter(|row| row["event"] == "end" && row["phase"] == "check.total")
                    .count(),
                1
            );
            let project = header["project"].as_str().unwrap();
            let observation = if project.starts_with("parallel-") {
                "parallel.observation".to_string()
            } else {
                format!("{project}.observation")
            };
            assert_eq!(
                owned
                    .iter()
                    .filter(|row| row["event"] == observation)
                    .count(),
                1
            );
        }
        std::fs::remove_dir_all(root).unwrap();
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

    #[test]
    fn an_existing_process_file_is_not_adopted() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-case-costs-existing");
        std::fs::create_dir_all(&root).unwrap();
        let path = process_file_path(&root);
        std::fs::write(&path, b"unowned observations\n").unwrap();
        let session = session_at(&root, camino::Utf8Path::new("fixture"), "examples".into());
        assert!(session.total.is_none());
        event(serde_json::json!({"event":"not published"}));
        drop(session);
        assert_eq!(std::fs::read(&path).unwrap(), b"unowned observations\n");
        std::fs::remove_dir_all(root).unwrap();
    }
}
