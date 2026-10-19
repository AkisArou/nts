//! Counting mode: how much work a fixed loop does, counted rather than timed.
//!
//! `tooling/bench/README.md` is the spec: the FIFO enable/ack/disable
//! protocol, the environment a driver is handed, admission, and the artifact
//! layout. This module is the coordinator. Preparation is shared with timed
//! mode (`wasm_prepare`, `node_harness`) so a counted row measures the same
//! artifact a timed row does.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    case_tsconfig, entry_points, node_harness, provider_for, timed_cpus, wanted_lanes, wasm_prepare,
};
use nts_core::hir;

/// Hold new cells below this, in KiB available.
const HOLD_BELOW_KIB: u64 = 12 * 1024 * 1024;
/// Resume (and first admit) at or above this, in KiB available.
const RESUME_AT_KIB: u64 = 14 * 1024 * 1024;
// The two constants above and "start held" mirror tooling/gate/admission.ts
// exactly: that file is the memory policy, this is a copy of it. The swap-out
// window below is a measurement-quality condition of counting mode's own, on
// top of the memory policy.
const SWAP_WINDOW_SECONDS: usize = 10;
const SWAP_MEAN_PAGES_PER_SECOND_MAX: f64 = 25.0;
const SWAP_SINGLE_SECOND_PAGES_PER_SECOND_MAX: f64 = 200.0;
#[allow(
    clippy::duration_suboptimal_units,
    reason = "the bound is quoted in seconds in the hold message and the spec"
)]
const ADMISSION_WAIT: Duration = Duration::from_secs(180);

/// The environment name for the baseline preparation child's overlay.
/// Documented in `tooling/bench/README.md`; the one spelling, on purpose.
const BASELINE_ENV: &str = "NTS_BENCH_COUNT_BASELINE_ENV";

/// One row's frozen work: chosen by calibration before any arm runs, and the
/// same for every arm after that.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct RowPlan {
    n: u64,
    warmup_node: u64,
    warmup_wasm: u64,
    checksum: String,
    node_ns_per_op: f64,
    wasm_ns_per_op: f64,
}

/// The frozen plans, as `plan.json` keeps them.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Plan {
    rows: BTreeMap<String, RowPlan>,
}

/// Persist one row plus the plan, after a completed cell.
type Save<'a> = &'a dyn Fn(&mut BTreeMap<String, Value>, &Value, &Plan) -> Result<()>;

/// What one `--count-prepare` child produced for one case.
#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    case: String,
    shown: String,
    /// `sha256` of the preparing binary: which compiler made these artifacts.
    binary_sha256: String,
    node_driver: String,
    node_driver_sha256: String,
    /// The Wasm harness path, when the backend produced a module.
    wasm_harness: Option<String>,
    /// File name to `sha256`, for every file in the Wasm artifact directory.
    wasm_files: BTreeMap<String, String>,
    /// Why there is no Wasm artifact, when there is none.
    absence: Option<String>,
}

/// A `count` driver's one JSON line (see the spec).
#[derive(Debug, Deserialize)]
struct Counted {
    checksum: String,
    warmup: u64,
    n: u64,
    #[serde(rename = "elapsedNs")]
    elapsed_ns: f64,
    #[serde(rename = "nsPerOp")]
    ns_per_op: f64,
}

/// A `calibrate` driver's one JSON line.
#[derive(Debug, Deserialize)]
struct Calibration {
    checksum: String,
    warmup: u64,
    #[serde(rename = "nsPerOp")]
    ns_per_op: f64,
}

/// `sha256` of a file, hex.
fn sha256_file(path: &Utf8Path) -> Result<String> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {path} to hash it"))?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut hex = String::with_capacity(64);
    for byte in hmac_sha256::Hash::hash(bytes) {
        let _written = write!(hex, "{byte:02x}");
    }
    hex
}

/// Write through a sibling then rename, so a reader (or a resumed run after a
/// crash mid-write) never sees half a report.
fn write_atomic(path: &Utf8Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.new");
    std::fs::write(&tmp, text).with_context(|| format!("writing {tmp}"))?;
    std::fs::rename(&tmp, path).with_context(|| format!("renaming {tmp} to {path}"))
}

#[allow(
    clippy::cast_precision_loss,
    reason = "available memory, recorded as a condition"
)]
fn gib(kib: u64) -> f64 {
    kib as f64 / 1_048_576.0
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis())
}

/// The fixed N for a row: about 100 ms of the slower column, clamped to the
/// drivers' own calibration ceiling.
fn frozen_n(node_ns_per_op: f64, wasm_ns_per_op: f64) -> u64 {
    let slowest = node_ns_per_op.max(wasm_ns_per_op);
    if slowest.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return 1;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to 1..=50M before the cast's result is used"
    )]
    let n = (100_000_000.0 / slowest).ceil() as u64;
    n.clamp(1, 50_000_000)
}

/// Parse `NTS_BENCH_COUNT_BASELINE_ENV`: `;`-separated `KEY=VALUE` pairs for
/// the baseline preparation child alone.
fn baseline_env(raw: &str) -> Result<Vec<(String, String)>> {
    let mut pairs = Vec::new();
    for part in raw.split(';').filter(|part| !part.trim().is_empty()) {
        let (key, value) = part
            .split_once('=')
            .with_context(|| format!("{BASELINE_ENV} entry `{part}` is not KEY=VALUE"))?;
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            bail!("{BASELINE_ENV} entry `{part}` names no usable variable");
        }
        pairs.push((key.to_owned(), value.to_owned()));
    }
    Ok(pairs)
}

/// The one instruction count in a `perf stat -x,` CSV.
///
/// perf prints a row per PMU on a hybrid part, and a row that did not run
/// reads `<not counted>`: none of that is zero, and two numeric rows would
/// mean the process straddled core types. Exactly one numeric
/// `instructions` row at 100.00% counter time is a count; anything else is a
/// failure with its reason, never a plausible-looking number.
fn parse_instructions(csv: &str) -> Result<u64> {
    let mut counted: Vec<u64> = Vec::new();
    let mut unsupported = false;
    for line in csv.lines() {
        let fields: Vec<&str> = line.split(',').collect();
        let Some(event) = fields.get(2) else { continue };
        if !event.contains("instructions") {
            continue;
        }
        let value = fields[0].trim();
        if value.contains("not supported") {
            unsupported = true;
            continue;
        }
        let Ok(count) = value.parse::<u64>() else {
            continue;
        };
        let percent: f64 = fields
            .get(4)
            .and_then(|field| field.trim().parse().ok())
            .unwrap_or(0.0);
        if (percent - 100.0).abs() > 0.01 {
            bail!(
                "instructions counter ran {percent:.2}% of the time (multiplexed); \
                 {count} is not the count"
            );
        }
        counted.push(count);
    }
    match counted.as_slice() {
        [count] if *count > 0 => Ok(*count),
        [0] => bail!("instructions counter reported zero for a loop that ran"),
        [] if unsupported => {
            bail!("instructions:u is <not supported> on this machine")
        }
        [] => bail!("perf reported no instructions count (not counted?)"),
        many => bail!(
            "perf reported {} instructions counts ({many:?}); the process straddled \
             core types and no one of them is the count",
            many.len()
        ),
    }
}

/// One read of the machine, for a cell's recorded conditions.
#[derive(Debug, Clone)]
struct Machine {
    available_kib: u64,
    swap_in: u64,
    swap_out: u64,
    /// `(total, idle)` ticks for CPUs 4 and 5, where the machine has them.
    /// Conditions only: admission never reads them, so a machine without a
    /// reserved pair still admits and counts.
    reserved: Option<[(u64, u64); 2]>,
    load1: f64,
}

fn machine() -> Result<Machine> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").context("reading /proc/meminfo")?;
    let vmstat = std::fs::read_to_string("/proc/vmstat").context("reading /proc/vmstat")?;
    let stat = std::fs::read_to_string("/proc/stat").context("reading /proc/stat")?;
    let loadavg = std::fs::read_to_string("/proc/loadavg").context("reading /proc/loadavg")?;
    let field = |text: &str, name: &str| -> Result<u64> {
        text.lines()
            .find_map(|line| {
                line.strip_prefix(name)
                    .and_then(|rest| rest.trim().trim_end_matches(" kB").parse().ok())
            })
            .with_context(|| format!("{name} missing from /proc"))
    };
    let ticks_for = |cpu: usize| -> Option<(u64, u64)> {
        let prefix = format!("cpu{cpu} ");
        let ticks: Vec<u64> = stat
            .lines()
            .find(|line| line.starts_with(&prefix))?
            .split_whitespace()
            .skip(1)
            .take(8)
            .map(|value| value.parse().ok())
            .collect::<Option<_>>()?;
        (ticks.len() == 8).then_some((ticks.iter().sum(), ticks[3] + ticks[4]))
    };
    let reserved = match (ticks_for(4), ticks_for(5)) {
        (Some(first), Some(second)) => Some([first, second]),
        _ => None,
    };
    Ok(Machine {
        available_kib: field(&meminfo, "MemAvailable:")?,
        swap_in: field(&vmstat, "pswpin ")?,
        swap_out: field(&vmstat, "pswpout ")?,
        reserved,
        load1: loadavg
            .split_whitespace()
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(-1.0),
    })
}

/// What the machine did while one cell ran, as recorded beside its count.
fn conditions(start: &Machine, end: &Machine) -> Value {
    #[allow(
        clippy::cast_precision_loss,
        reason = "recorded conditions, not verdicts; tick counts fit f64 exactly enough"
    )]
    let busy = |index: usize| -> Value {
        let (Some(before), Some(after)) = (start.reserved, end.reserved) else {
            return Value::Null;
        };
        let total = after[index].0 as f64 - before[index].0 as f64;
        if total <= 0.0 {
            return json!(1.0);
        }
        json!(1.0 - (after[index].1 as f64 - before[index].1 as f64) / total)
    };
    json!({
        "availableGiBStart": gib(start.available_kib),
        "availableGiBEnd": gib(end.available_kib),
        "swapInPages": end.swap_in.saturating_sub(start.swap_in),
        "swapOutPages": end.swap_out.saturating_sub(start.swap_out),
        "cpu4Busy": busy(0),
        "cpu5Busy": busy(1),
        "load1Start": start.load1,
        "load1End": end.load1,
    })
}

/// One admission sample. A sampler thread takes one a second for the life of
/// the run, so the swap window is already full when a cell asks.
#[derive(Debug)]
struct Sample {
    at: Instant,
    available_kib: u64,
    swap_out: u64,
}

/// Per-cell admission: the memory policy plus counting's swap window.
///
/// Sampling and sleeping happen here and nowhere else: admission holds
/// *between* cells. Nothing suspends work that is already running, and no
/// timed process is ever stopped.
#[derive(Debug)]
struct Admission {
    samples: Arc<Mutex<VecDeque<Sample>>>,
    held: bool,
}

impl Admission {
    fn start() -> Self {
        let samples: Arc<Mutex<VecDeque<Sample>>> = Arc::new(Mutex::new(VecDeque::new()));
        let thread_samples = Arc::clone(&samples);
        // Detached on purpose: it samples until the process exits, which is
        // exactly the run's life. A failed read skips that second rather
        // than inventing one.
        let _sampler = std::thread::spawn(move || {
            loop {
                if let Ok(read) = machine()
                    && let Ok(mut held) = thread_samples.lock()
                {
                    held.push_back(Sample {
                        at: Instant::now(),
                        available_kib: read.available_kib,
                        swap_out: read.swap_out,
                    });
                    while held.len() > 30 {
                        held.pop_front();
                    }
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });
        // Start held (admission.ts): the first cell waits for a real window.
        Self {
            samples,
            held: true,
        }
    }

    /// The swap window over the newest intervals: `(seconds, mean, max)`, or
    /// `None` until ten one-second intervals exist.
    fn window(&self) -> Option<(f64, f64, f64)> {
        let held = self.samples.lock().ok()?;
        let samples: Vec<&Sample> = held.iter().collect();
        let intervals: Vec<(f64, f64)> = samples
            .windows(2)
            .map(|pair| {
                let seconds = pair[1].at.duration_since(pair[0].at).as_secs_f64();
                #[allow(clippy::cast_precision_loss, reason = "page counters, recorded rates")]
                let pages = pair[1].swap_out.saturating_sub(pair[0].swap_out) as f64;
                (
                    seconds,
                    if seconds > 0.0 {
                        pages / seconds
                    } else {
                        f64::INFINITY
                    },
                )
            })
            .collect();
        if intervals.len() < SWAP_WINDOW_SECONDS {
            return None;
        }
        let newest = &intervals[intervals.len() - SWAP_WINDOW_SECONDS..];
        let seconds: f64 = newest.iter().map(|(seconds, _)| seconds).sum();
        let pages: f64 = newest.iter().map(|(seconds, rate)| seconds * rate).sum();
        let max = newest.iter().map(|(_, rate)| *rate).fold(0.0, f64::max);
        Some((seconds, pages / seconds, max))
    }

    fn available_kib(&self) -> Option<u64> {
        self.samples
            .lock()
            .ok()
            .and_then(|held| held.back().map(|sample| sample.available_kib))
    }

    /// Wait until a cell may start, and return the admission record to file
    /// beside it. A wait that outlasts the bound exits 75, resuming later:
    /// the report is saved after every completed cell, so nothing measured
    /// is lost.
    fn admit(&mut self, phase: &str) -> Value {
        let began = Instant::now();
        loop {
            if let Some(available) = self.available_kib() {
                if self.held && available >= RESUME_AT_KIB {
                    self.held = false;
                } else if !self.held && available < HOLD_BELOW_KIB {
                    self.held = true;
                }
                if !self.held
                    && let Some((seconds, mean, max)) = self.window()
                    && mean <= SWAP_MEAN_PAGES_PER_SECOND_MAX
                    && max <= SWAP_SINGLE_SECOND_PAGES_PER_SECOND_MAX
                {
                    return json!({
                        "phase": phase,
                        "availableGiB": gib(available),
                        "windowSeconds": seconds,
                        "swapOutMeanPagesPerSecond": mean,
                        "swapOutMaxPagesPerSecond": max,
                    });
                }
            }
            if began.elapsed() > ADMISSION_WAIT {
                eprintln!(
                    "ADMISSION HOLD: no admissible window for {phase} in {}s; \
                     completed cells are saved -- rerun the same command to resume",
                    ADMISSION_WAIT.as_secs()
                );
                std::process::exit(75);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

/// Cases by name, sorted, under `benchmarks/cases` — the same population a
/// timed run selects from.
fn cases(root: &Utf8Path, requested: &[String]) -> Result<Vec<(String, Utf8PathBuf)>> {
    let dir = root.join("benchmarks/cases");
    let mut found: Vec<(String, Utf8PathBuf)> = std::fs::read_dir(&dir)
        .with_context(|| format!("reading {dir}"))?
        .filter_map(|entry| {
            let path = Utf8PathBuf::from_path_buf(entry.ok()?.path()).ok()?;
            let name = path.file_name()?.to_owned();
            (path.is_dir() && path.join("case.ts").exists()).then_some((name, path))
        })
        .collect();
    found.sort();
    if !requested.is_empty() {
        for want in requested {
            if !found.iter().any(|(name, _)| name == want) {
                bail!("no benchmark case named `{want}` under {dir}");
            }
        }
        found.retain(|(name, _)| requested.contains(name));
    }
    Ok(found)
}

/// Positional case names from argv, skipping every known flag's value.
fn requested(argv: &[String], value_flags: &[&str]) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = argv.iter();
    while let Some(arg) = rest.next() {
        if value_flags.contains(&arg.as_str()) {
            let _value = rest.next();
        } else if !arg.starts_with('-') {
            names.push(arg.clone());
        }
    }
    names
}

fn flag_value<'a>(argv: &'a [String], flag: &str) -> Result<Option<&'a str>> {
    match argv.iter().position(|arg| arg == flag) {
        Some(at) => argv
            .get(at + 1)
            .map(String::as_str)
            .with_context(|| format!("`{flag}` needs a value after it"))
            .map(Some),
        None => Ok(None),
    }
}

/// What a counting-capable nts-bench answers to `--count-probe`.
const PROBE_MARKER: &str = "nts-bench counting mode 1";

/// Ask a binary once whether it speaks counting mode, before any row is
/// prepared: a baseline that predates the mode must fail here, in one
/// message, not after running a timed bench per row. The trailing case
/// name bounds what an old binary does with the unknown flag (it reads it
/// as a case filter and measures nothing).
fn probe_counting(binary: &str) -> Result<()> {
    let output = std::process::Command::new(binary)
        .arg("--count-probe")
        .arg("__count_probe__")
        .output()
        .with_context(|| format!("probing {binary} for counting mode"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() && stdout.trim() == PROBE_MARKER {
        return Ok(());
    }
    bail!(
        "{binary} does not speak counting mode (answer to --count-probe: status {}, \
         stdout {:?}); build the baseline from a tree that has it",
        output.status,
        stdout.chars().take(200).collect::<String>()
    )
}

/// Counting-mode entry from `main`: `Some` when argv asks for it.
pub(crate) fn dispatch(root: &Utf8Path, argv: &[String]) -> Option<Result<()>> {
    if argv.iter().any(|arg| arg == "--count-probe") {
        println!("{PROBE_MARKER}");
        Some(Ok(()))
    } else if argv.iter().any(|arg| arg == "--count-prepare") {
        Some(prepare(root, argv))
    } else if argv.iter().any(|arg| arg == "--count") {
        Some(run(root, argv))
    } else {
        None
    }
}

/// Whether a `wasm_prepare` error is the compiler declining this program
/// (a blank cell with a reason) rather than the world failing around it
/// (an error the run must surface and retry). Declines speak in their own
/// spellings: the backend's `declined:`, the custom-driver sentence, or a
/// rendered diagnostic carrying an NTS code.
fn is_decline(said: &str) -> bool {
    said.starts_with("declined:")
        || said.starts_with("its own driver.mjs")
        || said
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|word| {
                word.len() > 3
                    && word.starts_with("NTS")
                    && word[3..].chars().all(|c| c.is_ascii_digit())
            })
}

/// `--count-prepare <dir> [case...]`: prepare counting artifacts with *this*
/// binary and write a manifest per case. Internal: the coordinator spawns it
/// once per arm, so each side's artifacts come from its own compiler through
/// the same preparation the timed columns use.
pub(crate) fn prepare(root: &Utf8Path, argv: &[String]) -> Result<()> {
    let dir = Utf8PathBuf::from(
        flag_value(argv, "--count-prepare")?.context("--count-prepare needs a directory")?,
    );
    let wanted = requested(argv, &["--root", "--count-prepare"]);
    let binary = std::env::current_exe().context("locating this nts-bench binary")?;
    let binary_sha256 =
        sha256_file(Utf8Path::from_path(&binary).context("this binary's path is not UTF-8")?)?;
    for (name, case) in cases(root, &wanted)? {
        let out = dir.join(&name);
        std::fs::create_dir_all(&out).with_context(|| format!("creating {out}"))?;
        let tsconfig = case_tsconfig(&case, &out, &name)?;
        let entry = entry_points(&case)?;
        let node_driver = node_harness(&case, &out, &name)?;
        let (wasm_harness, wasm_files, absence) =
            match wasm_prepare(&case, &out, &name, &tsconfig, &entry) {
                Ok(harness) => {
                    let wasm_dir = out.join(format!("{name}.wasm"));
                    let mut files = BTreeMap::new();
                    for file in std::fs::read_dir(&wasm_dir)
                        .with_context(|| format!("reading {wasm_dir}"))?
                    {
                        let path = Utf8PathBuf::from_path_buf(file?.path())
                            .map_err(|path| anyhow::anyhow!("not UTF-8: {}", path.display()))?;
                        if path.is_file() {
                            let file_name =
                                path.file_name().context("an artifact file needs a name")?;
                            files.insert(file_name.to_owned(), sha256_file(&path)?);
                        }
                    }
                    (Some(harness.to_string()), files, None)
                }
                Err(error) => {
                    let said = format!("{error:#}");
                    if !is_decline(&said) {
                        // Not the backend refusing the program: the machine or
                        // the filesystem failed. That fails preparation (and
                        // retries on a rerun), never an absent cell.
                        return Err(error.context(format!(
                            "preparing {name}'s Wasm artifact (infrastructure, not a decline)"
                        )));
                    }
                    (
                        None,
                        BTreeMap::new(),
                        Some(said.split_whitespace().collect::<Vec<_>>().join(" ")),
                    )
                }
            };
        let shown = match provider_for(&case) {
            hir::Provider::ReferenceCounting => format!("{name} (rc)"),
            hir::Provider::NoGc | hir::Provider::HostGc => name.clone(),
        };
        let manifest = Manifest {
            case: name.clone(),
            shown,
            binary_sha256: binary_sha256.clone(),
            node_driver_sha256: sha256_file(&node_driver)?,
            node_driver: node_driver.to_string(),
            wasm_harness,
            wasm_files,
            absence,
        };
        write_atomic(
            &out.join("PREPARE.json"),
            &(serde_json::to_string_pretty(&manifest)? + "\n"),
        )?;
        println!("prepared {}", manifest.shown);
    }
    Ok(())
}

/// One recorded child: stdout on success, with the raw streams and the
/// machine's conditions filed in its directory either way.
#[derive(Debug)]
struct ChildOutcome {
    stdout: String,
    condition: Value,
}

/// A counted or calibrated cell gets this long. Its fixed loop targets
/// ~100 ms; the bound is for process startup, warmup and a sick machine,
/// not for the work.
const CELL_DEADLINE: Duration = Duration::from_mins(2);
/// Preparation compiles a case through the frontend; slower, still bounded.
const PREPARE_DEADLINE: Duration = Duration::from_mins(10);

/// Run one child with its streams filed in `dir`, under a deadline.
///
/// Streams go to files, never pipes this process waits on: a perf that dies
/// after forking node leaves node holding inherited pipe ends, and a
/// coordinator waiting on those pipes would hold the measurement lock for
/// good. The child runs in its own process group; at the deadline the group
/// is killed (perf and the driver it forked, together) and the cell fails
/// with its streams kept. `drop_after_spawn` is closed once the child
/// exists — the perf FIFO ends held only to unblock the opens, so a dead
/// perf gives the driver's ack read an EOF instead of silence.
fn run_child(
    dir: &Utf8Path,
    command: &mut std::process::Command,
    admission: &Value,
    deadline: Duration,
    drop_after_spawn: Vec<std::fs::File>,
) -> Result<ChildOutcome> {
    use std::os::unix::process::CommandExt as _;
    std::fs::create_dir_all(dir).with_context(|| format!("creating {dir}"))?;
    let program = command.get_program().to_string_lossy().into_owned();
    let args: Vec<String> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let stdout_path = dir.join("stdout");
    let stderr_path = dir.join("stderr");
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::fs::File::create(&stdout_path)?)
        .stderr(std::fs::File::create(&stderr_path)?)
        .process_group(0);
    let start = machine()?;
    let began = Instant::now();
    let mut child = command
        .spawn()
        .with_context(|| format!("running {program}"))?;
    let pid = child.id();
    drop(drop_after_spawn);
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if began.elapsed() > deadline {
            timed_out = true;
            let _killed = std::process::Command::new("kill")
                .arg("-KILL")
                .arg(format!("-{pid}"))
                .status();
            break child.wait()?;
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let end = machine()?;
    let stdout = std::fs::read_to_string(&stdout_path).unwrap_or_default();
    let stderr = std::fs::read_to_string(&stderr_path).unwrap_or_default();
    let condition = conditions(&start, &end);
    write_atomic(
        &dir.join("PROCESS.json"),
        &(serde_json::to_string_pretty(&json!({
            "program": program,
            "args": args,
            "pid": pid,
            "exit": status.code(),
            "timedOut": timed_out,
            "deadlineSeconds": deadline.as_secs(),
            "condition": condition,
            "admission": admission,
        }))? + "\n"),
    )?;
    if timed_out {
        bail!(
            "{program} exceeded its {}s deadline; killed its process group {pid} \
             (a hung perf or driver must not hold the measurement lock); \
             streams kept in {dir}",
            deadline.as_secs()
        );
    }
    if !status.success() {
        let tail: String = stderr
            .chars()
            .skip(stderr.chars().count().saturating_sub(2000))
            .collect();
        bail!("{program} exited {status}: {tail}");
    }
    Ok(ChildOutcome { stdout, condition })
}

/// `node <driver>`, confined to the timed CPUs when one is selected, with no
/// inherited `NODE_OPTIONS`: a loader injected there would run inside the
/// thing being counted.
fn node_command(driver: &str, cpus: Option<&str>) -> std::process::Command {
    let mut command = if let Some(cpus) = cpus {
        let mut confined = std::process::Command::new("taskset");
        confined.arg("-c").arg(cpus).arg("node").arg(driver);
        confined
    } else {
        let mut plain = std::process::Command::new("node");
        plain.arg(driver);
        plain
    };
    command.env_remove("NODE_OPTIONS");
    command
}

fn json_line<T: serde::de::DeserializeOwned>(stdout: &str, what: &str) -> Result<T> {
    let line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .with_context(|| format!("no {what} JSON on stdout"))?;
    serde_json::from_str(line).with_context(|| format!("parsing the {what} JSON line: {line}"))
}

fn calibrate(
    driver: &str,
    dir: &Utf8Path,
    cpus: Option<&str>,
    admission: &mut Admission,
) -> Result<Calibration> {
    let record = admission.admit(&format!("calibrate {driver}"));
    let mut command = node_command(driver, cpus);
    command.env("NTS_BENCH_COUNT_MODE", "calibrate");
    let outcome = run_child(dir, &mut command, &record, CELL_DEADLINE, Vec::new())?;
    json_line(&outcome.stdout, "calibration")
}

/// One counted cell: perf disabled around the process, enabled by the driver
/// only around its fixed loop. Returns the cell as filed in the report.
#[allow(
    clippy::too_many_arguments,
    reason = "one cell's whole instruction set, used once each"
)]
fn count_cell(
    driver: &str,
    n: u64,
    warmup: u64,
    dir: &Utf8Path,
    cpus: Option<&str>,
    perf: &str,
    admission: &mut Admission,
) -> Result<Value> {
    let record = admission.admit(&format!("count {driver}"));
    count_cell_admitted(driver, n, warmup, dir, cpus, perf, &record, CELL_DEADLINE)
}

/// One counted cell whose admission is already taken. Split from
/// `count_cell` so the protocol tests can run a cell under a controlled perf
/// stand-in without waiting out a real admission window.
#[allow(
    clippy::too_many_arguments,
    reason = "one cell's whole instruction set, used once each"
)]
fn count_cell_admitted(
    driver: &str,
    n: u64,
    warmup: u64,
    dir: &Utf8Path,
    cpus: Option<&str>,
    perf: &str,
    record: &Value,
    deadline: Duration,
) -> Result<Value> {
    let attempt = dir.join(format!("attempt-{}", now_ms()));
    std::fs::create_dir_all(&attempt).with_context(|| format!("creating {attempt}"))?;
    let control = attempt.join("control");
    let ack = attempt.join("ack");
    let made = std::process::Command::new("mkfifo")
        .arg(&control)
        .arg(&ack)
        .output()
        .context("running mkfifo for the perf control FIFOs")?;
    if !made.status.success() {
        bail!("mkfifo failed: {}", String::from_utf8_lossy(&made.stderr));
    }
    // Opened read-write so neither perf nor the driver blocks opening its
    // end before the other exists, and handed to run_child to close as soon
    // as perf is spawned: holding the ack write end past that would keep a
    // dead perf's driver waiting on an ack that can never come.
    let held = vec![
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&control)?,
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ack)?,
    ];
    let mut command = std::process::Command::new(perf);
    command
        .args(["stat", "-D", "-1"])
        .arg("--control")
        .arg(format!("fifo:{control},{ack}"))
        .args(["-e", "instructions:u", "-x,", "-o"])
        .arg(attempt.join("perf.csv"))
        .arg("--");
    if let Some(cpus) = cpus {
        command.arg("taskset").arg("-c").arg(cpus);
    }
    command
        .arg("node")
        .arg(driver)
        .env_remove("NODE_OPTIONS")
        .env("NTS_BENCH_COUNT_MODE", "count")
        .env("NTS_BENCH_COUNT_N", n.to_string())
        .env("NTS_BENCH_COUNT_WARMUP", warmup.to_string())
        .env("NTS_BENCH_COUNT_CONTROL", control.as_str())
        .env("NTS_BENCH_COUNT_ACK", ack.as_str());
    let outcome = run_child(&attempt, &mut command, record, deadline, held)?;
    let csv = std::fs::read_to_string(attempt.join("perf.csv"))
        .context("reading perf.csv (a missing file means perf never counted)")?;
    let instructions = parse_instructions(&csv)?;
    let counted: Counted = json_line(&outcome.stdout, "count")?;
    if counted.n != n || counted.warmup != warmup {
        bail!(
            "driver ran n={} warmup={} under a plan of n={n} warmup={warmup}",
            counted.n,
            counted.warmup
        );
    }
    #[allow(clippy::cast_precision_loss, reason = "counts reported per operation")]
    let per_op = instructions as f64 / n as f64;
    Ok(json!({
        "instructions": instructions,
        "instructionsPerOp": per_op,
        "checksum": counted.checksum,
        "warmup": counted.warmup,
        "n": counted.n,
        "elapsedNs": counted.elapsed_ns,
        "nsPerOp": counted.ns_per_op,
        "condition": outcome.condition,
        "admission": record,
        "dir": attempt.to_string(),
    }))
}

/// Saves the report and the plan together: after every completed cell, so a
/// held admission or a crash loses nothing already measured.
fn save_all(out: &Utf8Path, report: &Value, plan: &Plan) -> Result<()> {
    write_atomic(
        &out.join("REPORT.json"),
        &(serde_json::to_string_pretty(report)? + "\n"),
    )?;
    write_atomic(
        &out.join("plan.json"),
        &(serde_json::to_string_pretty(plan)? + "\n"),
    )
}

fn f64_at(value: &Value, keys: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in keys {
        current = current.get(key)?;
    }
    current.as_f64()
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted.get(sorted.len() / 2).copied().unwrap_or(f64::NAN)
}

/// The A/B reading of one measured row: each F against the geometric mean of
/// its neighbouring B arms, so drift inside the run argues with itself
/// before it argues with the verdict.
fn summarise(row: &Value, against: bool, identical: bool) -> (Value, String) {
    let arm = |label: &str, field: &str| f64_at(row, &["arms", label, "wasm", field]);
    if !against {
        let wasm = arm("F1", "instructionsPerOp").unwrap_or(f64::NAN);
        let node = f64_at(row, &["arms", "F1", "node", "instructionsPerOp"]).unwrap_or(f64::NAN);
        return (
            json!({"wasmInstructionsPerOp": wasm, "nodeInstructionsPerOp": node,
                   "wasmToNodeInstructions": wasm / node}),
            "measured".to_owned(),
        );
    }
    let b = ["B1", "B2", "B3"].map(|label| arm(label, "instructionsPerOp").unwrap_or(f64::NAN));
    let f = ["F1", "F2"].map(|label| arm(label, "instructionsPerOp").unwrap_or(f64::NAN));
    let ratios = [f[0] / (b[0] * b[1]).sqrt(), f[1] / (b[1] * b[2]).sqrt()];
    let verdict = if identical {
        "identical artifacts; instrument/engine variation"
    } else if ratios.iter().all(|ratio| *ratio < 1.0) {
        "fewer instructions in both rounds"
    } else if ratios.iter().all(|ratio| *ratio > 1.0) {
        "more instructions in both rounds"
    } else {
        "mixed rounds; read the ratios, not a verdict"
    };
    (
        json!({
            "bInstructionsPerOpMedian": median(&b),
            "fInstructionsPerOp": f,
            "fToBInstructions": ratios,
        }),
        verdict.to_owned(),
    )
}

/// Everything a row needs beyond the row itself.
#[derive(Debug)]
struct RunCtx {
    root: Utf8PathBuf,
    out: Utf8PathBuf,
    cpus: Option<String>,
    perf: String,
    fixed_n: Option<u64>,
    /// `(label, side)` in execution order.
    arms: Vec<(String, String)>,
    /// side -> nts-bench binary path.
    binaries: BTreeMap<String, String>,
    /// side -> that binary's sha256 at run start.
    binary_hashes: BTreeMap<String, String>,
    baseline_overlay: Vec<(String, String)>,
}

/// Verify a prepared artifact still hashes to its manifest. A prepared arm
/// that changed under the run is a different measurement than the one that
/// was prepared, and it fails rather than counts.
fn verify_manifest(manifest: &Manifest) -> Result<()> {
    let node_hash = sha256_file(Utf8Path::new(&manifest.node_driver))?;
    if node_hash != manifest.node_driver_sha256 {
        bail!(
            "node driver {} changed after preparation",
            manifest.node_driver
        );
    }
    if let Some(harness) = &manifest.wasm_harness {
        let dir = Utf8Path::new(harness)
            .parent()
            .context("the Wasm harness has no directory")?;
        for (file, expected) in &manifest.wasm_files {
            let actual = sha256_file(&dir.join(file))?;
            if actual != *expected {
                bail!("prepared artifact {file} changed after preparation");
            }
        }
    }
    Ok(())
}

/// Prepare every side this row's arms need, or resume to the manifests
/// already on disk, verifying nothing moved since preparation.
#[allow(
    clippy::too_many_arguments,
    reason = "the run's shared state, threaded explicitly"
)]
fn prepare_sides(
    ctx: &RunCtx,
    name: &str,
    admission: &mut Admission,
    rows: &mut BTreeMap<String, Value>,
    row: &mut Value,
    plan: &Plan,
    save: Save<'_>,
) -> Result<(Vec<String>, BTreeMap<String, Manifest>)> {
    let mut sides: Vec<String> = Vec::new();
    for (_, side) in &ctx.arms {
        if !sides.contains(side) {
            sides.push(side.clone());
        }
    }
    let mut manifests: BTreeMap<String, Manifest> = BTreeMap::new();
    for side in &sides {
        let manifest_path = ctx
            .out
            .join("artifacts")
            .join(side)
            .join(name)
            .join("PREPARE.json");
        if !manifest_path.exists() {
            let record = admission.admit(&format!("prepare {name} {side}"));
            let binary = ctx
                .binaries
                .get(side)
                .with_context(|| format!("no binary for side {side}"))?;
            let mut command = std::process::Command::new(binary);
            command
                .arg("--count-prepare")
                .arg(ctx.out.join("artifacts").join(side))
                .arg("--root")
                .arg(&ctx.root)
                .arg(name);
            if side == "B" {
                for (key, value) in &ctx.baseline_overlay {
                    command.env(key, value);
                }
            }
            run_child(
                &ctx.out
                    .join("artifacts")
                    .join(side)
                    .join(name)
                    .join("preparation"),
                &mut command,
                &record,
                PREPARE_DEADLINE,
                Vec::new(),
            )?;
        }
        let manifest: Manifest =
            serde_json::from_str(&std::fs::read_to_string(&manifest_path).with_context(|| {
                format!(
                    "reading {manifest_path} — a missing manifest usually means the \
                     {side} binary predates counting mode and has no --count-prepare; \
                     build that side from a tree that has it"
                )
            })?)
            .with_context(|| format!("parsing {manifest_path}"))?;
        if ctx
            .binary_hashes
            .get(side)
            .is_some_and(|hash| *hash != manifest.binary_sha256)
        {
            bail!(
                "{name}: the {side} artifacts were prepared by binary {} but this run's \
                 {side} binary is {}; prepare them again into a new --out",
                manifest.binary_sha256,
                ctx.binary_hashes[side]
            );
        }
        verify_manifest(&manifest)?;
        row["prepared"][side] = json!({
            "binarySha256": manifest.binary_sha256,
            "nodeDriverSha256": manifest.node_driver_sha256,
            "wasmFiles": manifest.wasm_files,
            "absence": manifest.absence,
        });
        manifests.insert(side.clone(), manifest);
        save(rows, row, plan)?;
    }
    Ok((sides, manifests))
}

/// A resumed row counts under the plan now in force, or not at all: cells
/// already counted must show that plan's exact n and warmups, or the run
/// would mix two fixed works into one ratio and call it a comparison.
fn check_plan_against_cells(row: &Value, plan: &RowPlan) -> Result<()> {
    let Some(arms) = row["arms"].as_object() else {
        return Ok(());
    };
    for (label, arm) in arms {
        for (column, warmup) in [("node", plan.warmup_node), ("wasm", plan.warmup_wasm)] {
            let cell = &arm[column];
            if cell.is_null() {
                continue;
            }
            if cell["n"] != json!(plan.n) || cell["warmup"] != json!(warmup) {
                bail!(
                    "plan moved: {label}/{column} was counted at n={} warmup={} but the                      plan now in force is n={} warmup={warmup}; a resumed run never mixes                      two fixed works — use a new --out for a new plan",
                    cell["n"],
                    cell["warmup"],
                    plan.n
                );
            }
        }
    }
    Ok(())
}

/// The row's frozen plan: the saved one when a plan already froze it, else
/// calibrated now against node's checksum before any arm runs.
fn frozen_plan(
    ctx: &RunCtx,
    name: &str,
    base: &Manifest,
    row: &mut Value,
    plan: &mut Plan,
    admission: &mut Admission,
) -> Result<RowPlan> {
    if let Some(frozen) = plan.rows.get(name).cloned() {
        if let Some(fixed) = ctx.fixed_n
            && fixed != frozen.n
        {
            bail!(
                "{name}: --fixed-n {fixed} differs from the frozen plan's n={} for this                  row; a resumed run counts under the plan it started with — use a new                  --out, or --plan with the cells it froze",
                frozen.n
            );
        }
        return Ok(frozen);
    }
    {
        let wasm_harness = base
            .wasm_harness
            .as_deref()
            .context("calibrating a row with no Wasm artifact")?;
        let node = calibrate(
            &base.node_driver,
            &ctx.out.join("calibration").join(name).join("node"),
            ctx.cpus.as_deref(),
            admission,
        )?;
        row["calibration"]["node"] = json!({
            "checksum": node.checksum, "warmup": node.warmup, "nsPerOp": node.ns_per_op,
        });
        let wasm = calibrate(
            wasm_harness,
            &ctx.out.join("calibration").join(name).join("wasm"),
            ctx.cpus.as_deref(),
            admission,
        )?;
        row["calibration"]["wasm"] = json!({
            "checksum": wasm.checksum, "warmup": wasm.warmup, "nsPerOp": wasm.ns_per_op,
        });
        if wasm.checksum != node.checksum {
            bail!(
                "{name}: wasm computed {} at calibration but node computed {}",
                wasm.checksum,
                node.checksum
            );
        }
        let frozen = RowPlan {
            n: ctx
                .fixed_n
                .unwrap_or_else(|| frozen_n(node.ns_per_op, wasm.ns_per_op)),
            warmup_node: node.warmup,
            warmup_wasm: wasm.warmup,
            checksum: node.checksum.clone(),
            node_ns_per_op: node.ns_per_op,
            wasm_ns_per_op: wasm.ns_per_op,
        };
        plan.rows.insert(name.to_owned(), frozen.clone());
        Ok(frozen)
    }
}

/// Count every arm not already counted: node freshly each arm as the
/// contamination bracket, then that arm's Wasm, checksums against the plan.
#[allow(
    clippy::too_many_arguments,
    reason = "the run's shared state, threaded explicitly"
)]
fn run_arms(
    ctx: &RunCtx,
    name: &str,
    manifests: &BTreeMap<String, Manifest>,
    base: &Manifest,
    row_plan: &RowPlan,
    shown: &str,
    admission: &mut Admission,
    rows: &mut BTreeMap<String, Value>,
    row: &mut Value,
    plan: &Plan,
    save: Save<'_>,
) -> Result<()> {
    for (label, side) in &ctx.arms {
        if row["arms"][label]["complete"] == json!(true) {
            continue;
        }
        if row["arms"][label]["node"].is_null() {
            let cell = count_cell(
                &base.node_driver,
                row_plan.n,
                row_plan.warmup_node,
                &ctx.out.join("runs").join(name).join(label).join("node"),
                ctx.cpus.as_deref(),
                &ctx.perf,
                admission,
            )?;
            if cell["checksum"] != json!(row_plan.checksum) {
                bail!(
                    "{name} {label}: node counted checksum {} against the plan's {}",
                    cell["checksum"],
                    row_plan.checksum
                );
            }
            row["arms"][label]["node"] = cell;
            save(rows, row, plan)?;
        }
        let harness = manifests[side]
            .wasm_harness
            .as_deref()
            .context("counting an arm with no Wasm artifact")?;
        let cell = count_cell(
            harness,
            row_plan.n,
            row_plan.warmup_wasm,
            &ctx.out.join("runs").join(name).join(label).join("wasm"),
            ctx.cpus.as_deref(),
            &ctx.perf,
            admission,
        )?;
        if cell["checksum"] != json!(row_plan.checksum) {
            bail!(
                "{name} {label}: wasm computed {} but node computed {} — \
                 counting it would price the wrong answer",
                cell["checksum"],
                row_plan.checksum
            );
        }
        row["arms"][label]["wasm"] = cell;
        let wasm_ns = f64_at(row, &["arms", label, "wasm", "nsPerOp"]).unwrap_or(f64::NAN);
        let node_ns = f64_at(row, &["arms", label, "node", "nsPerOp"]).unwrap_or(f64::NAN);
        let wasm_instructions =
            f64_at(row, &["arms", label, "wasm", "instructionsPerOp"]).unwrap_or(f64::NAN);
        let node_instructions =
            f64_at(row, &["arms", label, "node", "instructionsPerOp"]).unwrap_or(f64::NAN);
        row["arms"][label]["wasmToNodeWall"] = json!(wasm_ns / node_ns);
        row["arms"][label]["wasmToNodeInstructions"] = json!(wasm_instructions / node_instructions);
        row["arms"][label]["complete"] = json!(true);
        save(rows, row, plan)?;
        println!(
            "{shown:<24} {label} instructions/op wasm {wasm_instructions:.1} node {node_instructions:.1} wall wasm/node {:.3}",
            wasm_ns / node_ns
        );
    }
    Ok(())
}

#[allow(
    clippy::too_many_arguments,
    reason = "the run's shared state, threaded explicitly rather than global"
)]
fn run_row(
    ctx: &RunCtx,
    name: &str,
    admission: &mut Admission,
    rows: &mut BTreeMap<String, Value>,
    report: &Value,
    plan: &mut Plan,
) -> Result<()> {
    let mut row = rows.get(name).cloned().unwrap_or_else(|| json!({}));
    let checkpoint = |rows: &mut BTreeMap<String, Value>, row: &Value, plan: &Plan| {
        rows.insert(name.to_owned(), row.clone());
        let mut whole = report.clone();
        whole["rows"] = serde_json::to_value(&*rows)?;
        save_all(&ctx.out, &whole, plan)
    };

    let (sides, manifests) =
        prepare_sides(ctx, name, admission, rows, &mut row, plan, &checkpoint)?;

    let foreground = manifests
        .get("F")
        .context("the foreground arm did not prepare")?;
    row["shown"] = json!(foreground.shown);
    let shown = foreground.shown.clone();

    let absences: Vec<String> = sides
        .iter()
        .filter_map(|side| {
            manifests[side]
                .absence
                .as_ref()
                .map(|reason| format!("{side}: {reason}"))
        })
        .collect();
    if !absences.is_empty() {
        row["status"] = json!("absent");
        row["verdict"] = json!(format!("not measured: {}", absences.join("; ")));
        row["complete"] = json!(true);
        checkpoint(rows, &row, plan)?;
        println!("{shown:<24} not measured: {}", absences.join("; "));
        return Ok(());
    }

    let base_side = if manifests.contains_key("B") {
        "B"
    } else {
        "F"
    };
    let base = &manifests[base_side];
    for side in &sides {
        let other = &manifests[side];
        if other.node_driver_sha256 != base.node_driver_sha256
            || other.wasm_files.get("bench.mjs") != base.wasm_files.get("bench.mjs")
        {
            bail!(
                "{name}: the {side} drivers differ from {base_side}'s; the arms would count different harnesses"
            );
        }
    }
    // The whole artifact set, glue included: a glue-only change is a changed
    // arm, not instrument noise.
    let identical = manifests
        .get("B")
        .is_none_or(|baseline| baseline.wasm_files == foreground.wasm_files);
    row["artifactEquality"] = json!(if identical { "identical" } else { "changed" });

    let row_plan = frozen_plan(ctx, name, base, &mut row, plan, admission)?;
    check_plan_against_cells(&row, &row_plan)?;
    row["plan"] = serde_json::to_value(&row_plan)?;
    checkpoint(rows, &row, plan)?;

    run_arms(
        ctx,
        name,
        &manifests,
        base,
        &row_plan,
        &shown,
        admission,
        rows,
        &mut row,
        plan,
        &checkpoint,
    )?;

    let (summary, verdict) = summarise(&row, manifests.contains_key("B"), identical);
    row["summary"] = summary;
    row["verdict"] = json!(verdict);
    row["status"] = json!("measured");
    row["complete"] = json!(true);
    checkpoint(rows, &row, plan)
}

fn render_all_rows(
    selected: &[(String, Utf8PathBuf)],
    rows: &BTreeMap<String, Value>,
    against: bool,
) -> String {
    use std::fmt::Write as _;
    let mut text = String::new();
    let _ = writeln!(
        text,
        "Fixed work and warmup frozen per row before its arms. `perf stat -e instructions:u` \\\n\
         enabled after warmup, disabled after the fixed loop; the count includes the same \\\n\
         timer/control bookkeeping in every arm. Checksums match node in every measured \\\n\
         cell. Wall ratios are loaded observations, not quiet-core claims. Admission: \\\n\
         memory per tooling/gate/admission.ts (hold below 12 GiB, resume at 14 GiB) plus \\\n\
         a 10 s swap-out mean of at most 25 pages/s, no second above 200. Per-cell \\\n\
         conditions are in CELL-CONDITIONS.tsv; raw counters in REPORT.json and runs/."
    );
    let _ = writeln!(text);
    if against {
        let _ = writeln!(
            text,
            "F/B divides each F by the geometric mean of its neighbouring B arms; below 1 \\\n\
             is fewer instructions."
        );
        let _ = writeln!(text);
        let _ = writeln!(
            text,
            "| Row | B instructions/op (median) | F1 / F2 instructions/op | F/B instructions | Loaded wall wasm/node B/F/B/F/B | Artifact equality | Verdict |"
        );
        let _ = writeln!(text, "|---|---:|---:|---:|---|---|---|");
    } else {
        let _ = writeln!(
            text,
            "| Row | N | Wasm instructions/op | Node instructions/op | Wasm/node instructions | Loaded wall wasm/node | Verdict |"
        );
        let _ = writeln!(text, "|---|---:|---:|---:|---:|---:|---|");
    }
    for (name, _) in selected {
        let Some(row) = rows.get(name) else { continue };
        let shown = row["shown"].as_str().unwrap_or(name);
        let verdict = row["verdict"].as_str().unwrap_or("");
        if row["status"] != json!("measured") {
            let _ = writeln!(text, "| {shown} | — | — | — | — | — | {verdict} |");
            continue;
        }
        if against {
            let b_med = f64_at(row, &["summary", "bInstructionsPerOpMedian"]).unwrap_or(f64::NAN);
            let f = |index: usize| {
                row["summary"]["fInstructionsPerOp"][index]
                    .as_f64()
                    .unwrap_or(f64::NAN)
            };
            let r = |index: usize| {
                row["summary"]["fToBInstructions"][index]
                    .as_f64()
                    .unwrap_or(f64::NAN)
            };
            let wall: Vec<String> = ["B1", "F1", "B2", "F2", "B3"]
                .iter()
                .map(|label| {
                    format!(
                        "{:.3}",
                        f64_at(row, &["arms", label, "wasmToNodeWall"]).unwrap_or(f64::NAN)
                    )
                })
                .collect();
            let equality = row["artifactEquality"].as_str().unwrap_or("");
            let _ = writeln!(
                text,
                "| {shown} | {b_med:.1} | {:.1} / {:.1} | {:.4} / {:.4} | {} | {equality} | {verdict} |",
                f(0),
                f(1),
                r(0),
                r(1),
                wall.join(" / ")
            );
        } else {
            let n = row["plan"]["n"].as_u64().unwrap_or(0);
            let wasm = f64_at(row, &["summary", "wasmInstructionsPerOp"]).unwrap_or(f64::NAN);
            let node = f64_at(row, &["summary", "nodeInstructionsPerOp"]).unwrap_or(f64::NAN);
            let ratio = f64_at(row, &["summary", "wasmToNodeInstructions"]).unwrap_or(f64::NAN);
            let wall = f64_at(row, &["arms", "F1", "wasmToNodeWall"]).unwrap_or(f64::NAN);
            let _ = writeln!(
                text,
                "| {shown} | {n} | {wasm:.1} | {node:.1} | {ratio:.3} | {wall:.3} | {verdict} |"
            );
        }
    }
    text
}

fn render_conditions(
    selected: &[(String, Utf8PathBuf)],
    rows: &BTreeMap<String, Value>,
    arms: &[(String, String)],
) -> String {
    use std::fmt::Write as _;
    let mut text = String::from(
        "case\tarm\tcolumn\tinstructions\tnsPerOp\tavailableGiBStart\tswapWindowMean\tswapWindowMax\tcpu4Busy\tcpu5Busy\tload1Start\n",
    );
    for (name, _) in selected {
        let Some(row) = rows.get(name) else { continue };
        for (label, _) in arms {
            for column in ["node", "wasm"] {
                let cell = &row["arms"][label][column];
                if cell.is_null() {
                    continue;
                }
                let get = |keys: &[&str]| f64_at(cell, keys).unwrap_or(f64::NAN);
                let _ = writeln!(
                    text,
                    "{name}\t{label}\t{column}\t{}\t{:.4}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{:.2}",
                    cell["instructions"].as_u64().unwrap_or(0),
                    get(&["nsPerOp"]),
                    get(&["condition", "availableGiBStart"]),
                    get(&["admission", "swapOutMeanPagesPerSecond"]),
                    get(&["admission", "swapOutMaxPagesPerSecond"]),
                    get(&["condition", "cpu4Busy"]),
                    get(&["condition", "cpu5Busy"]),
                    get(&["condition", "load1Start"]),
                );
            }
        }
    }
    text
}

/// Flags that take a value, so positional parsing skips the values.
const VALUE_FLAGS: &[&str] = &["--root", "--out", "--against", "--plan", "--fixed-n"];

/// The binaries, their hashes, and the arm order for one run.
#[derive(Debug)]
struct ArmSetup {
    binaries: BTreeMap<String, String>,
    hashes: BTreeMap<String, String>,
    arms: Vec<(String, String)>,
}

/// Which binaries an arm prepares with, their hashes, and the arm order:
/// B/F/B/F/B against a baseline, one F arm alone.
fn binaries_and_arms(argv: &[String]) -> Result<ArmSetup> {
    let this_binary = std::env::current_exe().context("locating this nts-bench binary")?;
    let this_binary = this_binary.to_string_lossy().into_owned();
    let mut binaries: BTreeMap<String, String> = BTreeMap::new();
    binaries.insert("F".to_owned(), this_binary);
    let against = flag_value(argv, "--against")?;
    if let Some(baseline) = against {
        if !Utf8Path::new(baseline).exists() {
            bail!("--against names {baseline}, which does not exist");
        }
        binaries.insert("B".to_owned(), baseline.to_owned());
        probe_counting(baseline)?;
    }
    let binary_hashes: BTreeMap<String, String> = binaries
        .iter()
        .map(|(side, path)| Ok((side.clone(), sha256_file(Utf8Path::new(path))?)))
        .collect::<Result<_>>()?;
    let arms: Vec<(String, String)> = if against.is_some() {
        ["B1|B", "F1|F", "B2|B", "F2|F", "B3|B"]
            .iter()
            .filter_map(|pair| pair.split_once('|'))
            .map(|(label, side)| (label.to_owned(), side.to_owned()))
            .collect()
    } else {
        vec![("F1".to_owned(), "F".to_owned())]
    };
    Ok(ArmSetup {
        binaries,
        hashes: binary_hashes,
        arms,
    })
}

/// `--count [--against <baseline-nts-bench>] [--plan <file>] [--fixed-n <n>]
/// --out <dir> [case...]`
pub(crate) fn run(root: &Utf8Path, argv: &[String]) -> Result<()> {
    if let Some(lanes) = wanted_lanes() {
        let unsupported: Vec<&str> = lanes
            .iter()
            .map(String::as_str)
            .filter(|lane| *lane != "wasm")
            .collect();
        if !unsupported.is_empty() {
            bail!(
                "counting mode counts node and nts Wasm in v1; NTS_BENCH_LANES names {}, \
                 which has no counted driver yet (tooling/bench/README.md)",
                unsupported.join(", ")
            );
        }
    }
    {
        let mut rest = argv.iter();
        while let Some(arg) = rest.next() {
            if VALUE_FLAGS.contains(&arg.as_str()) {
                let _value = rest.next();
            } else if arg.starts_with("--") && arg != "--count" {
                bail!("unknown flag `{arg}` for --count");
            }
        }
    }
    let out =
        Utf8PathBuf::from(flag_value(argv, "--out")?.context(
            "--count needs --out <dir>: a count run is an evidence directory, not a table",
        )?);
    let fixed_n = match flag_value(argv, "--fixed-n")? {
        Some(value) => {
            let n: u64 = value.parse().context("--fixed-n is not a count")?;
            if n < 1 {
                bail!("--fixed-n must be at least 1");
            }
            Some(n)
        }
        None => None,
    };
    let wanted = requested(argv, VALUE_FLAGS);
    let selected = cases(root, &wanted)?;
    std::fs::create_dir_all(&out).with_context(|| format!("creating {out}"))?;

    let setup = binaries_and_arms(argv)?;
    let (binaries, binary_hashes, arms) = (setup.binaries, setup.hashes, setup.arms);
    let against = flag_value(argv, "--against")?;

    let report_path = out.join("REPORT.json");
    let mut report: Value = if report_path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&report_path)?)
            .with_context(|| format!("parsing {report_path} to resume"))?
    } else {
        json!({
            "startedMs": now_ms(),
            "root": root.to_string(),
            "primary": "instructions:u, enabled only around a fixed loop",
            "wall": "same loop under load; no quiet-core claim",
            "order": arms.iter().map(|(label, _)| label.clone()).collect::<Vec<_>>(),
            "binariesSha256": binary_hashes,
            "population": selected.iter().map(|(name, _)| name.clone()).collect::<Vec<_>>(),
            "rows": {},
        })
    };
    if report["binariesSha256"] != json!(binary_hashes) && report_path.exists() {
        bail!(
            "{out} was started by different nts-bench binaries ({}); a resumed run must \
             count with the binaries that prepared it",
            report["binariesSha256"]
        );
    }
    report["binariesSha256"] = json!(binary_hashes);
    let rows: BTreeMap<String, Value> =
        serde_json::from_value(report["rows"].clone()).unwrap_or_default();

    let plan: Plan = match flag_value(argv, "--plan")? {
        Some(path) => serde_json::from_str(
            &std::fs::read_to_string(path).with_context(|| format!("reading plan {path}"))?,
        )
        .context("parsing the --plan file")?,
        None if out.join("plan.json").exists() => {
            serde_json::from_str(&std::fs::read_to_string(out.join("plan.json"))?)
                .context("parsing the saved plan.json")?
        }
        None => Plan::default(),
    };

    let ctx = RunCtx {
        root: root.to_owned(),
        out: out.clone(),
        cpus: timed_cpus()?,
        perf: std::env::var("NTS_BENCH_COUNT_PERF")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "perf".to_owned()),
        fixed_n,
        arms: arms.clone(),
        binaries,
        binary_hashes: binary_hashes.clone(),
        baseline_overlay: match std::env::var(BASELINE_ENV) {
            Ok(raw) => baseline_env(&raw)?,
            Err(_) => Vec::new(),
        },
    };

    drive(&ctx, &selected, report, rows, plan, against.is_some())
}

/// The row loop and the evidence files, once the context exists.
#[allow(
    clippy::too_many_arguments,
    reason = "the run's shared state, threaded explicitly"
)]
fn drive(
    ctx: &RunCtx,
    selected: &[(String, Utf8PathBuf)],
    mut report: Value,
    mut rows: BTreeMap<String, Value>,
    mut plan: Plan,
    against: bool,
) -> Result<()> {
    let out = &ctx.out;
    let arms = &ctx.arms;
    let mut admission = Admission::start();
    let mut failed = false;
    for (name, _) in selected {
        // A complete row resumes only under the plan it was counted with: a
        // --plan that moved fails it here instead of leaving two fixed
        // works side by side in one report.
        let complete = rows
            .get(name)
            .is_some_and(|row| row["complete"] == json!(true));
        let moved = if complete {
            match (rows.get(name), plan.rows.get(name)) {
                (Some(row), Some(frozen)) => check_plan_against_cells(row, frozen),
                _ => Ok(()),
            }
        } else {
            Ok(())
        };
        if complete && moved.is_ok() {
            println!("{name:<24} already complete; resumed past it");
            continue;
        }
        let outcome = if complete {
            moved
        } else {
            run_row(ctx, name, &mut admission, &mut rows, &report, &mut plan)
        };
        match outcome {
            Ok(()) => {}
            Err(error) => {
                failed = true;
                let reason = format!("{error:#}")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                let mut row = rows.get(name).cloned().unwrap_or_else(|| json!({}));
                row["status"] = json!("failed");
                row["verdict"] = json!(format!("failed: {reason}"));
                // Not complete: a rerun retries the row from its last
                // checkpointed cell instead of resuming past a failure.
                row["complete"] = json!(false);
                rows.insert(name.clone(), row);
                report["rows"] = serde_json::to_value(&rows)?;
                save_all(out, &report, &plan)?;
                eprintln!("{name:<24} failed: {reason}");
            }
        }
        report["rows"] = serde_json::to_value(&rows)?;
    }
    report["rows"] = serde_json::to_value(&rows)?;
    report["passed"] = json!(!failed);
    report["endedMs"] = json!(now_ms());
    save_all(out, &report, &plan)?;
    let complete = selected.iter().all(|(name, _)| {
        rows.get(name)
            .is_some_and(|row| row["complete"] == json!(true))
    });
    if complete {
        std::fs::write(
            out.join("ALL-ROWS.md"),
            render_all_rows(selected, &rows, against),
        )?;
        std::fs::write(
            out.join("CELL-CONDITIONS.tsv"),
            render_conditions(selected, &rows, arms),
        )?;
    }
    if failed {
        bail!("counting run finished with failed rows; see {out}/REPORT.json");
    }
    println!(
        "counted {} of {} rows; evidence in {out}",
        rows.values()
            .filter(|row| row["status"] == json!("measured"))
            .count(),
        selected.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{baseline_env, count_cell_admitted, frozen_n, parse_instructions, sha256_hex};
    use camino::Utf8PathBuf;
    use serde_json::json;

    #[test]
    fn sha256_is_sha256() {
        // The empty string's digest, known independently of this crate.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn frozen_n_targets_the_slower_column_and_clamps() {
        assert_eq!(frozen_n(100.0, 50.0), 1_000_000);
        assert_eq!(frozen_n(50.0, 100.0), 1_000_000);
        assert_eq!(frozen_n(1.0, 1.0), 50_000_000);
        assert_eq!(frozen_n(1_000_000_000.0, 1.0), 1);
        assert_eq!(frozen_n(0.0, 0.0), 1);
    }

    #[test]
    fn baseline_env_parses_pairs_and_refuses_junk() {
        let parsed = baseline_env("NTS_A=1;NTS_B=x=y").expect("pairs parse");
        assert_eq!(
            parsed,
            vec![
                ("NTS_A".to_owned(), "1".to_owned()),
                ("NTS_B".to_owned(), "x=y".to_owned())
            ]
        );
        assert!(baseline_env("").expect("empty is empty").is_empty());
        assert!(baseline_env("NOEQUALS").is_err());
        assert!(baseline_env("=1").is_err());
        assert!(baseline_env("A B=1").is_err());
    }

    #[test]
    fn perf_csv_one_numeric_row_at_full_time() {
        let hybrid = "164216,,cpu_core/instructions/u,330140,100.00,,\n\
                      <not counted>,,cpu_atom/instructions/u,0,0.00,,\n";
        assert_eq!(parse_instructions(hybrid).expect("one count"), 164_216);
    }

    #[test]
    fn perf_csv_refuses_what_is_not_a_count() {
        for (csv, why) in [
            (
                "<not supported>,,instructions:u,0,0.00,,\n",
                "not supported",
            ),
            (
                "<not counted>,,instructions:u,0,0.00,,\n",
                "no instructions count",
            ),
            ("123,,instructions:u,10,50.00,,\n", "multiplexed"),
            ("0,,instructions:u,10,100.00,,\n", "zero"),
            (
                "1,,cpu_core/instructions/u,1,100.00,,\n2,,cpu_atom/instructions/u,1,100.00,,\n",
                "straddled",
            ),
            ("", "no instructions count"),
        ] {
            let error = parse_instructions(csv).expect_err("must refuse");
            assert!(
                error.to_string().contains(why),
                "csv {csv:?} refused for the wrong reason: {error}"
            );
        }
    }

    /// A controlled perf stand-in speaking the FIFO protocol, so the driver
    /// and the coordinator are exercised together with no host perf. It
    /// verifies exactly one enable/disable pair and writes the CSV it is
    /// given in its own source.
    fn fake_perf(dir: &camino::Utf8Path, csv: &str) -> Utf8PathBuf {
        use std::os::unix::fs::PermissionsExt as _;
        let path = dir.join("fake-perf.mjs");
        let script = format!(
            "#!/usr/bin/env node\n\
             import {{ spawn }} from 'node:child_process';\n\
             import {{ openSync, readSync, writeSync, writeFileSync }} from 'node:fs';\n\
             const argv = process.argv.slice(2);\n\
             const controlSpec = argv[argv.indexOf('--control') + 1];\n\
             const [ctl, ack] = controlSpec.slice('fifo:'.length).split(',');\n\
             const outFile = argv[argv.indexOf('-o') + 1];\n\
             const command = argv.slice(argv.indexOf('--') + 1);\n\
             const child = spawn(command[0], command.slice(1), {{ stdio: 'inherit' }});\n\
             const ctlFd = openSync(ctl, 'r');\n\
             const ackFd = openSync(ack, 'w');\n\
             const commands = [];\n\
             const byte = Buffer.alloc(1);\n\
             let line = '';\n\
             while (commands.length < 2) {{\n\
               if (readSync(ctlFd, byte, 0, 1, null) !== 1) break;\n\
               line += byte.toString();\n\
               if (line.endsWith('\\n')) {{ commands.push(line.trim()); line = ''; writeSync(ackFd, 'ack\\n\\0'); }}\n\
             }}\n\
             const exit = await new Promise((resolve) => child.once('close', resolve));\n\
             writeFileSync(outFile, {csv:?});\n\
             if (commands.join(',') !== 'enable,disable') {{ console.error('protocol: ' + commands.join(',')); process.exit(3); }}\n\
             process.exit(exit ?? 1);\n"
        );
        std::fs::write(&path, script).expect("write fake perf");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("make fake perf executable");
        path
    }

    fn scratch(tag: &str) -> Utf8PathBuf {
        // Under target/, not /tmp: FIFOs and drivers beside the build that
        // made them, on the big disk.
        let dir = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/nts-bench-count-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _removed = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create scratch");
        let bench =
            Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/common/bench.mjs");
        std::fs::write(
            dir.join("driver.mjs"),
            format!("import {{ measure }} from \"{bench}\";\nmeasure(() => 16);\n"),
        )
        .expect("write driver");
        dir
    }

    #[test]
    fn counted_cell_speaks_the_protocol_and_reads_the_count() {
        let dir = scratch("cell");
        let perf = fake_perf(
            &dir,
            "1234567,,cpu_core/instructions/u,1000,100.00,,\n<not counted>,,cpu_atom/instructions/u,0,0.00,,\n",
        );
        let cell = count_cell_admitted(
            dir.join("driver.mjs").as_str(),
            1_000,
            10,
            &dir.join("runs"),
            None,
            perf.as_str(),
            &json!({"phase": "test"}),
            std::time::Duration::from_secs(30),
        )
        .expect("cell counts");
        assert_eq!(cell["instructions"], json!(1_234_567));
        // 16.0's f64 bits, the same spelling every column compares.
        assert_eq!(cell["checksum"], json!("4030000000000000"));
        assert_eq!(cell["n"], json!(1_000));
        let _removed = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn counted_cell_refuses_an_unsupported_counter() {
        let dir = scratch("unsupported");
        let perf = fake_perf(&dir, "<not supported>,,instructions:u,0,0.00,,\n");
        let error = count_cell_admitted(
            dir.join("driver.mjs").as_str(),
            10,
            0,
            &dir.join("runs"),
            None,
            perf.as_str(),
            &json!({"phase": "test"}),
            std::time::Duration::from_secs(30),
        )
        .expect_err("must refuse");
        assert!(error.to_string().contains("not supported"), "{error}");
        let _removed = std::fs::remove_dir_all(&dir);
    }

    fn write_fake(dir: &camino::Utf8Path, name: &str, script: &str) -> Utf8PathBuf {
        use std::os::unix::fs::PermissionsExt as _;
        let path = dir.join(name);
        std::fs::write(&path, script).expect("write fake");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("make fake executable");
        path
    }

    /// The perf side of the protocol up to the first ack, shared by the
    /// death fakes: spawn the driver, open both FIFOs, ack one command.
    const FAKE_PRELUDE: &str = "#!/usr/bin/env node\n\
        import { spawn } from 'node:child_process';\n\
        import { openSync, readSync, writeSync } from 'node:fs';\n\
        const argv = process.argv.slice(2);\n\
        const [ctl, ack] = argv[argv.indexOf('--control') + 1].slice('fifo:'.length).split(',');\n\
        const command = argv.slice(argv.indexOf('--') + 1);\n\
        spawn(command[0], command.slice(1), { stdio: 'inherit' });\n\
        const ctlFd = openSync(ctl, 'r');\n\
        const ackFd = openSync(ack, 'w');\n";

    #[test]
    fn a_perf_that_dies_mid_cell_fails_the_cell_not_the_run() {
        let dir = scratch("dies");
        // Ack the enable, then die the way an OOM kill would leave it.
        let perf = write_fake(
            &dir,
            "fake-perf-dies.mjs",
            &format!(
                "{FAKE_PRELUDE}\
                 const byte = Buffer.alloc(1); let line = '';\n\
                 while (!line.endsWith('\\n')) {{ readSync(ctlFd, byte, 0, 1, null); line += byte.toString(); }}\n\
                 writeSync(ackFd, 'ack\\n\\0');\n\
                 process.exit(9);\n"
            ),
        );
        let began = std::time::Instant::now();
        let error = count_cell_admitted(
            dir.join("driver.mjs").as_str(),
            1_000_000,
            10,
            &dir.join("runs"),
            None,
            perf.as_str(),
            &json!({"phase": "test"}),
            std::time::Duration::from_secs(30),
        )
        .expect_err("a dead perf is a failed cell");
        assert!(
            began.elapsed() < std::time::Duration::from_secs(20),
            "the coordinator hung on a dead perf: {error}"
        );
        let _removed = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_perf_that_never_acks_is_killed_at_the_deadline() {
        let dir = scratch("hangs");
        let perf = write_fake(
            &dir,
            "fake-perf-hangs.mjs",
            &format!("{FAKE_PRELUDE}setInterval(() => {{}}, 1000);\n"),
        );
        let began = std::time::Instant::now();
        let error = count_cell_admitted(
            dir.join("driver.mjs").as_str(),
            1_000,
            10,
            &dir.join("runs"),
            None,
            perf.as_str(),
            &json!({"phase": "test"}),
            std::time::Duration::from_secs(2),
        )
        .expect_err("a silent perf hits the deadline");
        assert!(
            error.to_string().contains("exceeded its 2s deadline"),
            "{error}"
        );
        assert!(began.elapsed() < std::time::Duration::from_secs(20));
        let _removed = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_moved_plan_refuses_cells_counted_under_the_old_one() {
        let plan = super::RowPlan {
            n: 20,
            warmup_node: 5,
            warmup_wasm: 7,
            checksum: "00".to_owned(),
            node_ns_per_op: 1.0,
            wasm_ns_per_op: 1.0,
        };
        let row = json!({"arms": {"B1": {
            "node": {"n": 10, "warmup": 5},
            "wasm": {"n": 10, "warmup": 7},
        }}});
        let error = super::check_plan_against_cells(&row, &plan).expect_err("must refuse");
        assert!(error.to_string().contains("plan moved"), "{error}");
        let same = json!({"arms": {"B1": {
            "node": {"n": 20, "warmup": 5},
            "wasm": {"n": 20, "warmup": 7},
        }}});
        assert!(super::check_plan_against_cells(&same, &plan).is_ok());
        assert!(super::check_plan_against_cells(&json!({}), &plan).is_ok());
    }

    #[test]
    fn declines_are_not_infrastructure_failures() {
        assert!(super::is_decline("declined: NTS5001 no"));
        assert!(super::is_decline(
            "its own driver.mjs imports case.ts, so there is no harness"
        ));
        assert!(super::is_decline("error NTS2001: refused somewhere"));
        assert!(!super::is_decline("reading /x: No space left on device"));
        assert!(!super::is_decline("cannot allocate memory"));
    }

    #[test]
    fn probe_knows_a_counting_binary_from_an_old_one() {
        let dir = scratch("probe");
        let good = write_fake(
            &dir,
            "new-bench",
            "#!/bin/sh\necho 'nts-bench counting mode 1'\n",
        );
        assert!(super::probe_counting(good.as_str()).is_ok());
        let old = write_fake(&dir, "old-bench", "#!/bin/sh\necho 'case  C++  nts C'\n");
        let error = super::probe_counting(old.as_str()).expect_err("must refuse");
        assert!(
            error.to_string().contains("does not speak counting mode"),
            "{error}"
        );
        let _removed = std::fs::remove_dir_all(&dir);
    }
}
