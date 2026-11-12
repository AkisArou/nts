//! Call boundaries belong to the trusted driver, separately from its answers.
//! The driver blocks at each boundary while its owner samples process
//! CPU, so a fast following call cannot be charged to the preceding one.

/// Generic runaway guard for an instrument, independent of a case allowance.
pub(super) const COMMAND_CPU_BUDGET_SECONDS: f64 = 30.0 * 60.0;

use std::io::Write as _;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::check_report::{Incomplete, IncompleteKind};

use anyhow::{Context as _, Result, ensure};
use camino::Utf8Path;

use crate::case_costs;

pub(super) const NATIVE: &str = r#"
static FILE *nts_check_activity_events;
static FILE *nts_check_activity_ack;
static unsigned long nts_check_activity_pid;
static int nts_check_activity_mark(const char *event, long index) {
    const char *events = getenv("NTS_DIFF_CALL_EVENTS");
    if (events == NULL) return 1;
    if (nts_check_activity_events == NULL) {
        FILE *identity = fopen("/proc/self/stat", "r");
        if (identity == NULL) return 0;
        int read = fscanf(identity, "%lu", &nts_check_activity_pid);
        fclose(identity);
        if (read != 1) return 0;
        nts_check_activity_events = fopen(events, "a");
    }
    if (nts_check_activity_events == NULL) return 0;
    if (fprintf(nts_check_activity_events, "v1 %s %ld %lu\n", event, index, nts_check_activity_pid) < 0
        || fflush(nts_check_activity_events) != 0) return 0;
    if (nts_check_activity_ack == NULL) {
        const char *ack = getenv("NTS_DIFF_CALL_ACK");
        if (ack == NULL) return 0;
        nts_check_activity_ack = fopen(ack, "r");
    }
    return nts_check_activity_ack != NULL && fgetc(nts_check_activity_ack) == '1';
}
"#;

#[derive(Debug, Default)]
struct Boundaries {
    next: usize,
    total: usize,
    ready: bool,
    active: bool,
    done: bool,
    previous_cpu: u64,
    completed: usize,
}

impl Boundaries {
    fn observe(&mut self, line: &str, cpu: u64, hz: u32) -> Result<()> {
        let fields: Vec<_> = line.split_whitespace().collect();
        ensure!(
            fields.len() == 4 && fields[0] == "v1",
            "invalid call activity frame"
        );
        let index: usize = fields[2].parse().context("invalid call activity index")?;
        ensure!(
            index == self.next && !self.done,
            "out-of-order call activity"
        );
        match fields[1] {
            "ready" => {
                ensure!(!self.ready && !self.active, "duplicate call readiness");
                self.ready = true;
            }
            "begin" => {
                ensure!(
                    self.ready && !self.active && index < self.total,
                    "invalid call begin"
                );
                self.active = true;
            }
            "end" => {
                ensure!(self.active, "call ended without a begin");
                ensure!(cpu >= self.previous_cpu, "call CPU counter moved backwards");
                case_costs::event(serde_json::json!({"event":"program.call", "index":index,
                    "cpu_ticks":cpu-self.previous_cpu,"clock_ticks_per_second":hz,
                    "includes_startup":self.completed==0,"cpu_scope":"driver-process-all-threads-and-waited-children"}));
                self.previous_cpu = cpu;
                self.completed += 1;
                self.next += 1;
                self.active = false;
            }
            "done" => {
                ensure!(
                    self.ready && !self.active && index == self.total,
                    "incomplete call activity"
                );
                ensure!(
                    cpu >= self.previous_cpu,
                    "cleanup CPU counter moved backwards"
                );
                case_costs::event(serde_json::json!({"event":"program.cleanup",
                    "cpu_ticks":cpu-self.previous_cpu,"clock_ticks_per_second":hz,
                    "cpu_scope":"driver-process-all-threads-and-waited-children"}));
                self.done = true;
            }
            _ => anyhow::bail!("unknown call activity event"),
        }
        Ok(())
    }
}

#[derive(Debug)]
struct Process {
    state: char,
    group: u32,
    session: u32,
    running: bool,
    /// Its main thread runs, waits for a core (R), or waits in the kernel (D).
    busy: bool,
    started: u64,
    cpu: u64,
}

/// A thread that runs or waits for a core (R), or waits in the kernel (D) --
/// on a disk, or held at its cgroup's memory limit -- is busy: a loaded
/// machine or a memory cap can keep it there with no CPU progress, and that
/// is not a hang. A thread asleep (S) waits for an event, as a hang does.
fn busy_state(state: &str) -> bool {
    matches!(state, "R" | "D")
}

fn process(text: &str) -> Result<Option<Process>> {
    let end = text.rfind(')').context("invalid process name")?;
    let fields: Vec<_> = text[end + 1..].split_whitespace().collect();
    let field =
        |at: usize| -> Result<&str> { fields.get(at).copied().context("missing process field") };
    let number = |at: usize| -> Result<u64> {
        field(at)?
            .parse()
            .with_context(|| format!("invalid unsigned process field {}", at + 3))
    };
    // proc_pid_stat(5): pgrp/session are signed ints, and waited-child
    // CPU times are signed longs. A task losing its signal state during
    // exit is printed with pgrp/session -1 by fs/proc/array.c.
    let group: i32 = field(2)?.parse().context("invalid process group")?;
    let session: i32 = field(3)?.parse().context("invalid process session")?;
    if group < 0 || session < 0 || matches!(field(0)?, "X" | "x") {
        return Ok(None);
    }
    let mut cpu = number(11)?
        .checked_add(number(12)?)
        .context("process CPU overflow")?;
    for at in [13, 14] {
        let children: i64 = field(at)?
            .parse()
            .with_context(|| format!("invalid signed process field {}", at + 3))?;
        cpu = cpu
            .checked_add(u64::try_from(children).context("negative waited-child CPU")?)
            .context("process CPU overflow")?;
    }
    Ok(Some(Process {
        state: field(0)?.chars().next().context("missing process state")?,
        group: u32::try_from(group)?,
        session: u32::try_from(session)?,
        running: !matches!(fields[0], "Z" | "X"),
        busy: busy_state(field(0)?),
        started: number(19)?,
        cpu,
    }))
}

/// Whether any thread of `pid` is busy: a process's own state is only its
/// main thread's. A thread that ends as it is read is not busy.
fn threads_busy(pid: u32) -> bool {
    let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) else {
        return false;
    };
    tasks.flatten().any(|task| {
        std::fs::read_to_string(task.path().join("stat")).is_ok_and(|text| {
            text.rfind(')')
                .and_then(|end| text.get(end + 2..end + 3))
                .is_some_and(busy_state)
        })
    })
}

fn process_at(pid: u32) -> Result<Option<Process>> {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(text) => process(&text),
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound || error.raw_os_error() == Some(3) =>
        {
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}

fn boundary_cpu(
    group: u32,
    started: u64,
    line: &str,
    driver: &mut Option<(u32, u64)>,
) -> Result<u64> {
    let leader = process_at(group)?.context("owned child disappeared before its boundary")?;
    ensure!(
        leader.group == group && leader.started == started,
        "owned child identity changed"
    );
    let pid: u32 = line
        .split_whitespace()
        .nth(3)
        .context("missing activity process")?
        .parse()?;
    ensure!(pid > 1, "invalid activity process");
    let record = process_at(pid)?.context("activity sender disappeared at its boundary")?;
    ensure!(
        record.group == group,
        "activity sender is outside the owned group"
    );
    if let Some(identity) = *driver {
        ensure!(
            identity == (pid, record.started),
            "activity sender identity changed"
        );
    } else {
        *driver = Some((pid, record.started));
    }
    Ok(record.cpu)
}

fn seconds(ticks: u64, hz: u32) -> f64 {
    Duration::from_secs(ticks)
        .div_f64(f64::from(hz))
        .as_secs_f64()
}

fn ticks() -> Result<u32> {
    let output = Command::new("getconf").arg("CLK_TCK").output()?;
    ensure!(
        output.status.success(),
        "cannot read process CPU clock frequency"
    );
    let ticks = std::str::from_utf8(&output.stdout)?.trim().parse()?;
    ensure!(ticks > 0, "invalid process CPU clock frequency");
    Ok(ticks)
}

#[derive(Debug)]
enum CleanupState {
    Pending,
    Finished,
    Failed(String),
}
impl CleanupState {
    fn run(&mut self, group: u32, action: impl FnOnce() -> Result<()>) -> Result<()> {
        match self {
            Self::Finished => return Ok(()),
            Self::Failed(reason) => anyhow::bail!(reason.clone()),
            Self::Pending => {}
        }
        match action() {
            Ok(()) => {
                *self = Self::Finished;
                Ok(())
            }
            Err(error) => {
                let reason = format!("compiled cleanup INSTRUMENT: owned group {group}: {error:#}");
                *self = Self::Failed(reason.clone());
                anyhow::bail!(reason)
            }
        }
    }
}

#[derive(Debug)]
struct OwnedChild {
    child: Option<Child>,
    pid: u32,
    identity: Option<(u64, u32)>,
    cleanup: CleanupState,
}

impl OwnedChild {
    fn finish(&mut self) -> Result<()> {
        self.finish_with(&mut LiveCleanup)
    }
    fn finish_with(&mut self, cleanup: &mut impl CleanupObserver) -> Result<()> {
        let group = self.pid;
        let identity = self.identity;
        let child = &mut self.child;
        self.cleanup.run(group, || {
            // The waiter can already have reaped the leader. Surviving members
            // retain this PGID, preventing its number from being reused; always
            // finish that owned group even after the leader's exit event.
            if let Some(now) = process_at(group)? {
                ensure!(
                    now.group == group
                        && identity.is_none_or(|identity| (now.started, now.session) == identity),
                    "refusing a changed child group"
                );
            }
            let remaining = group_remains(group)?;
            if remaining {
                let killed = Command::new("kill")
                    .args(["-KILL", "--", &format!("-{group}")])
                    .output()?;
                if !killed.status.success() {
                    // A group that exited between observation and kill needs no
                    // signal. A live group must never be silently left behind.
                    ensure!(!group_remains(group)?, "cannot stop owned compiled group");
                }
            }
            wait_for_cleanup(group, cleanup)?;
            if let Some(child) = child {
                child.wait()?;
            }
            Ok(())
        })
    }
}

fn group_cpu(group: u32) -> Result<u64> {
    let mut cpu = 0_u64;
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
        else {
            continue;
        };
        let record = match process_at(pid) {
            Ok(value) => value,
            Err(error) if pid == group => return Err(error),
            Err(_) => continue,
        };
        if let Some(record) = record.filter(|record| record.group == group) {
            cpu = cpu
                .checked_add(record.cpu)
                .context("owned group CPU overflow")?;
        }
    }
    Ok(cpu)
}

/// Whether a thread of any process in `group` is busy (`busy_state`).
fn group_busy(group: u32) -> Result<bool> {
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
        else {
            continue;
        };
        let Ok(Some(record)) = process_at(pid) else {
            continue;
        };
        if record.group == group && record.running && (record.busy || threads_busy(pid)) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Debug, Clone)]
struct RemainingProcess {
    pid: u32,
    state: char,
    started: u64,
}

fn group_members(group: u32) -> Result<Vec<RemainingProcess>> {
    let mut members = Vec::new();
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        if let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
            && let Some(process) =
                process_at(pid)?.filter(|process| process.group == group && process.running)
        {
            members.push(RemainingProcess {
                pid,
                state: process.state,
                started: process.started,
            });
        }
    }
    Ok(members)
}
fn group_remains(group: u32) -> Result<bool> {
    Ok(!group_members(group)?.is_empty())
}

// SIGKILL precedes kernel exit and reaping. This is a wedged-instrument
// backstop, not a case allowance: a loaded machine may take seconds to drain
// an owned group, so only five minutes without complete cleanup fails closed.
const CLEANUP_WEDGE_BOUND: Duration = Duration::from_secs(5 * 60);
trait CleanupObserver {
    fn now(&self) -> Instant;
    fn members(&mut self, group: u32) -> Result<Vec<RemainingProcess>>;
    fn pause(&mut self);
}
struct LiveCleanup;
impl CleanupObserver for LiveCleanup {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn members(&mut self, group: u32) -> Result<Vec<RemainingProcess>> {
        group_members(group)
    }
    fn pause(&mut self) {
        thread::sleep(Duration::from_millis(5));
    }
}
fn wait_for_cleanup(group: u32, observer: &mut impl CleanupObserver) -> Result<()> {
    let started = observer.now();
    loop {
        let members = observer.members(group)?;
        if members.is_empty() {
            return Ok(());
        }
        let elapsed = observer.now().duration_since(started);
        if elapsed >= CLEANUP_WEDGE_BOUND {
            let remaining = members
                .iter()
                .map(|member| format!("{}:{} (start {})", member.pid, member.state, member.started))
                .collect::<Vec<_>>()
                .join(", ");
            anyhow::bail!(
                "wedged-cleanup bound {CLEANUP_WEDGE_BOUND:?} reached after {elapsed:?}; remaining {remaining}"
            );
        }
        observer.pause();
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

/// CPU allowances are calibrated per arm; inactivity is separate from cost.
#[derive(Debug, Clone, Copy)]
pub(super) struct Limits {
    pub cpu_seconds: f64,
    pub idle: Duration,
}

#[derive(Debug)]
pub(super) struct Finished {
    pub output: Output,
    pub incomplete: Option<Incomplete>,
}

impl From<Output> for Finished {
    fn from(output: Output) -> Self {
        Self {
            output,
            incomplete: None,
        }
    }
}

struct Channel {
    owner: Option<std::fs::File>,
    reader: Option<std::fs::File>,
    ack: std::fs::File,
    driver: Option<(u32, u64)>,
    boundaries: Boundaries,
}

impl Channel {
    fn new(command: &mut Command, results: &Utf8Path, from: usize, total: usize) -> Result<Self> {
        let events = results.with_extension("activity");
        let ack = results.with_extension("ack");
        for path in [&events, &ack] {
            let made = Command::new("mkfifo")
                .args(["-m", "600", path.as_str()])
                .output()?;
            ensure!(made.status.success(), "cannot create owned call channel");
        }
        // Linux O_RDWR FIFO opens never block. Keep only the owner's writer;
        // the separate O_RDONLY event thread must receive EOF after cleanup.
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&events)?;
        let reader = std::fs::File::open(&events)?;
        let ack_file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ack)?;
        command
            .env("NTS_DIFF_CALL_EVENTS", &events)
            .env("NTS_DIFF_CALL_ACK", &ack);
        Ok(Self {
            owner: Some(owner),
            reader: Some(reader),
            ack: ack_file,
            driver: None,
            boundaries: Boundaries {
                next: from,
                total,
                ..Boundaries::default()
            },
        })
    }
    fn observe(
        &mut self,
        line: &str,
        group: u32,
        started: u64,
        hz: u32,
        budget: f64,
    ) -> Result<Option<Incomplete>> {
        let cpu = boundary_cpu(group, started, line, &mut self.driver)?;
        if seconds(cpu.saturating_sub(self.boundaries.previous_cpu), hz) >= budget {
            return Ok(Some(self.runaway(cpu, hz, budget)));
        }
        self.boundaries.observe(line, cpu, hz)?;
        self.ack.write_all(b"1")?;
        Ok(None)
    }
    fn runaway(&self, cpu: u64, hz: u32, budget: f64) -> Incomplete {
        Incomplete {
            kind: IncompleteKind::Runaway,
            reason: format!(
                "compiled call consumed {:.3} CPU seconds, reaching its {budget:.3} second allowance",
                seconds(cpu.saturating_sub(self.boundaries.previous_cpu), hz)
            ),
            case_index: (self.boundaries.next < self.boundaries.total)
                .then_some(self.boundaries.next),
        }
    }
}

#[derive(Debug)]
enum Notice {
    Output(bool, Vec<u8>),
    Boundary(String),
    Broken(String),
    Eof,
    Exited(std::process::ExitStatus),
}

fn child_waiter(
    mut child: Child,
    sender: std::sync::mpsc::Sender<Notice>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let notice = match child.wait() {
            Ok(status) => Notice::Exited(status),
            Err(error) => Notice::Broken(format!("waiting for owned child: {error}")),
        };
        let _ = sender.send(notice);
        let _ = sender.send(Notice::Eof);
    })
}

fn output_reader(
    mut pipe: impl std::io::Read + Send + 'static,
    standard: bool,
    sender: std::sync::mpsc::Sender<Notice>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut bytes = [0_u8; 8192];
        loop {
            match pipe.read(&mut bytes) {
                Ok(0) => break,
                Ok(read) => {
                    if sender
                        .send(Notice::Output(standard, bytes[..read].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Notice::Broken(format!("reading child output: {error}")));
                    break;
                }
            }
        }
        let _ = sender.send(Notice::Eof);
    })
}

fn event_reader(
    file: std::fs::File,
    sender: std::sync::mpsc::Sender<Notice>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        use std::io::BufRead as _;
        for line in std::io::BufReader::new(file).lines() {
            match line {
                Ok(line) => {
                    if sender.send(Notice::Boundary(line)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Notice::Broken(format!("reading call boundary: {error}")));
                    break;
                }
            }
        }
        let _ = sender.send(Notice::Eof);
    })
}

/// What the supervisor reads of its owned group: /proc for a real child, a
/// script in the tests of the idle decision.
trait Probe {
    fn now(&self) -> Instant;
    fn leader(&self, group: u32) -> Result<Option<Process>>;
    fn group_cpu(&self, group: u32) -> Result<u64>;
    /// Whether a thread of the group is busy; asked only when no CPU moved.
    fn busy(&self, group: u32, leader: &Process) -> Result<bool>;
}

struct Live;
impl Probe for Live {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn leader(&self, group: u32) -> Result<Option<Process>> {
        process_at(group)
    }
    fn group_cpu(&self, group: u32) -> Result<u64> {
        group_cpu(group)
    }
    fn busy(&self, group: u32, leader: &Process) -> Result<bool> {
        Ok(leader.busy || threads_busy(group) || group_busy(group)?)
    }
}

struct Watch {
    hz: u32,
    limits: Limits,
    last: Instant,
    cpu: u64,
    group_at: Instant,
    group_period: Duration,
    group_cpu: u64,
    group_budget: f64,
}
impl Watch {
    fn new(
        identity: &Process,
        hz: u32,
        limits: Limits,
        channel: Option<&Channel>,
        now: Instant,
    ) -> Self {
        let budget = channel.map_or(limits.cpu_seconds, |c| {
            let calls = u32::try_from(c.boundaries.total - c.boundaries.next).unwrap_or(u32::MAX);
            (limits.cpu_seconds * (f64::from(calls) + 1.0)).min(COMMAND_CPU_BUDGET_SECONDS)
        });
        Self {
            hz,
            limits,
            last: now,
            cpu: identity.cpu,
            group_at: now,
            group_period: Duration::from_secs(5).min(limits.idle / 4),
            group_cpu: identity.cpu,
            group_budget: budget,
        }
    }
    fn activity(&mut self, now: Instant) {
        self.last = now;
    }
    fn sample(
        &mut self,
        probe: &impl Probe,
        group: u32,
        identity: (u64, u32),
        channel: Option<&Channel>,
    ) -> Result<Option<Incomplete>> {
        let now = probe.now();
        if now.duration_since(self.group_at) >= self.group_period {
            let cpu = probe.group_cpu(group)?;
            if cpu != self.group_cpu {
                self.last = now;
                self.group_cpu = cpu;
            }
            if seconds(cpu, self.hz) >= self.group_budget {
                return Ok(Some(Incomplete {
                    kind: IncompleteKind::Runaway,
                    reason: format!(
                        "owned command group consumed {:.3} CPU seconds, reaching its {:.3} second allowance",
                        seconds(cpu, self.hz),
                        self.group_budget
                    ),
                    case_index: None,
                }));
            }
            self.group_at = now;
        }
        // The waiter may have reaped it before its exit message is dequeued.
        // That message, rather than a timer, will finish the owned group.
        let Some(current) = probe.leader(group)? else {
            return Ok(None);
        };
        ensure!(
            (current.started, current.session) == identity && current.group == group,
            "supervised child identity changed"
        );
        if current.cpu != self.cpu {
            self.last = now;
            self.cpu = current.cpu;
        } else if probe.busy(group, &current)? {
            // Running, waiting for a core or held in the kernel, however long
            // a loaded machine or a memory cap keeps it there: hung means
            // every thread sleeps with no output and no CPU progress.
            self.last = now;
        }
        let baseline = channel.map_or(0, |c| c.boundaries.previous_cpu);
        let used = seconds(current.cpu.saturating_sub(baseline), self.hz);
        if used >= self.limits.cpu_seconds {
            return Ok(Some(channel.map_or_else(||Incomplete {kind:IncompleteKind::Runaway,
            reason:format!("command consumed {used:.3} CPU seconds, reaching its {:.3} second allowance",self.limits.cpu_seconds),case_index:None},|c|c.runaway(current.cpu,self.hz,self.limits.cpu_seconds))));
        }
        Ok(
            (now.duration_since(self.last) >= self.limits.idle).then(|| Incomplete {
                kind: IncompleteKind::Hung,
                reason: format!(
                    "no output, completed call, process CPU activity or busy thread for {} ms",
                    self.limits.idle.as_millis()
                ),
                case_index: channel.and_then(|c| {
                    (c.boundaries.next < c.boundaries.total).then_some(c.boundaries.next)
                }),
            }),
        )
    }
}

struct Running {
    owned: OwnedChild,
    channel: Option<Channel>,
    watch: Watch,
    receiver: std::sync::mpsc::Receiver<Notice>,
    readers: Vec<thread::JoinHandle<()>>,
    remaining: usize,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    incomplete: Option<Incomplete>,
    closed: bool,
    status: Option<std::process::ExitStatus>,
}
impl Running {
    fn spawn(mut command: Command, limits: Limits, mut channel: Option<Channel>) -> Result<Self> {
        use std::os::unix::process::CommandExt as _;
        ensure!(
            limits.cpu_seconds.is_finite() && limits.cpu_seconds > 0.0 && !limits.idle.is_zero(),
            "invalid child activity budget"
        );
        let hz = ticks()?;
        let child = command
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("starting supervised program")?;
        let pid = child.id();
        let mut owned = OwnedChild {
            child: Some(child),
            pid,
            identity: None,
            cleanup: CleanupState::Pending,
        };
        let identity = process_at(owned.pid)?.context("supervised program has no identity")?;
        ensure!(
            identity.group == owned.pid,
            "supervised program has no owned process group"
        );
        owned.identity = Some((identity.started, identity.session));
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut readers = vec![
            output_reader(
                owned
                    .child
                    .as_mut()
                    .context("owned child")?
                    .stdout
                    .take()
                    .context("child stdout")?,
                true,
                sender.clone(),
            ),
            output_reader(
                owned
                    .child
                    .as_mut()
                    .context("owned child")?
                    .stderr
                    .take()
                    .context("child stderr")?,
                false,
                sender.clone(),
            ),
        ];
        if let Some(channel) = &mut channel {
            readers.push(event_reader(
                channel.reader.take().context("call event reader")?,
                sender.clone(),
            ));
        }
        readers.push(child_waiter(
            owned.child.take().context("owned child waiter")?,
            sender,
        ));
        let remaining = readers.len();
        let watch = Watch::new(&identity, hz, limits, channel.as_ref(), Live.now());
        Ok(Self {
            owned,
            channel,
            watch,
            receiver,
            readers,
            remaining,
            stdout: Vec::new(),
            stderr: Vec::new(),
            incomplete: None,
            closed: false,
            status: None,
        })
    }
    fn close(&mut self) -> Result<()> {
        if !self.closed {
            let stopped = self.owned.finish();
            if let Some(channel) = &mut self.channel {
                drop(channel.owner.take());
            }
            stopped?;
            self.closed = true;
        }
        Ok(())
    }
    fn receive(&mut self, notice: Notice) -> Result<()> {
        match notice {
            Notice::Output(standard, bytes) => {
                self.watch.activity(Live.now());
                if standard {
                    self.stdout.extend(bytes);
                } else {
                    self.stderr.extend(bytes);
                }
            }
            Notice::Boundary(line) if !self.closed => {
                let channel = self.channel.as_mut().context("unexpected call event")?;
                self.incomplete = channel.observe(
                    &line,
                    self.owned.pid,
                    self.owned.identity.context("owned identity")?.0,
                    self.watch.hz,
                    self.watch.limits.cpu_seconds,
                )?;
                self.watch.activity(Live.now());
            }
            Notice::Boundary(_) => {}
            Notice::Broken(message) => anyhow::bail!(message),
            Notice::Exited(status) => {
                ensure!(
                    self.status.replace(status).is_none(),
                    "duplicate child exit event"
                );
            }
            Notice::Eof => {
                self.remaining = self
                    .remaining
                    .checked_sub(1)
                    .context("duplicate reader EOF")?;
            }
        }
        Ok(())
    }
    fn run(mut self) -> Result<Finished> {
        let period = Duration::from_millis(250)
            .min(self.watch.limits.idle / 4)
            .max(Duration::from_millis(1));
        let mut sample_at = Instant::now();
        let result = (|| -> Result<()> {
            while !self.closed || self.remaining > 0 {
                if !self.closed {
                    if let Some(status) = self.status {
                        if let Some(channel) = &self.channel {
                            ensure!(
                                !status.success() || channel.boundaries.done,
                                "successful child left incomplete call activity"
                            );
                        }
                        self.close()?;
                    } else if self.incomplete.is_some() {
                        self.close()?;
                    } else if sample_at.elapsed() >= period {
                        self.incomplete = self.watch.sample(
                            &Live,
                            self.owned.pid,
                            self.owned.identity.context("owned identity")?,
                            self.channel.as_ref(),
                        )?;
                        sample_at = Instant::now();
                        if self.incomplete.is_some() {
                            self.close()?;
                        }
                    }
                }
                if self.closed && self.remaining == 0 {
                    break;
                }
                match self.receiver.recv_timeout(period) {
                    Ok(notice) => self.receive(notice)?,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        ensure!(self.remaining == 0, "child reader ended without EOF");
                        if !self.closed {
                            thread::sleep(period);
                        }
                    }
                }
            }
            Ok(())
        })();
        self.close()?;
        // On a malformed stream, the killed group has no remaining writers;
        // dropping the owner's event FIFO lets all blocking readers reach EOF.
        while self.remaining > 0 {
            let Ok(notice) = self.receiver.recv() else {
                break;
            };
            let _ = self.receive(notice);
        }
        for reader in self.readers {
            reader
                .join()
                .map_err(|_| anyhow::anyhow!("child reader panicked"))?;
        }
        result?;
        Ok(Finished {
            output: Output {
                status: self.status.context("owned child has no exit event")?,
                stdout: self.stdout,
                stderr: self.stderr,
            },
            incomplete: self.incomplete,
        })
    }
}

/// Per-call boundaries reset only CPU cost, never an absolute wall deadline.
pub(super) fn run(
    mut command: Command,
    results: &Utf8Path,
    from: usize,
    total: usize,
    limits: Limits,
) -> Result<Finished> {
    let channel = Channel::new(&mut command, results, from, total)?;
    Running::spawn(command, limits, Some(channel))?.run()
}
/// The Node oracle and compiled arms share ownership, sampling and cleanup.
pub(super) fn command(command: Command, limits: Limits) -> Result<Finished> {
    Running::spawn(command, limits, None)?.run()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn node(source: &str) -> Command {
        let mut command = Command::new("node");
        command.args(["-e", source]);
        command
    }

    struct Scripted {
        at: std::cell::Cell<Instant>,
        cpu: std::cell::Cell<u64>,
        descendant_cpu: std::cell::Cell<u64>,
        busy: bool,
        present: bool,
    }
    impl Scripted {
        fn new(busy: bool) -> Self {
            Self {
                at: std::cell::Cell::new(Instant::now()),
                cpu: std::cell::Cell::new(0),
                descendant_cpu: std::cell::Cell::new(0),
                busy,
                present: true,
            }
        }
        fn advance(&self, by: Duration) {
            self.at.set(self.at.get() + by);
        }
        fn watch(&self, limits: Limits) -> Watch {
            Watch::new(
                &self.leader(42).unwrap().unwrap(),
                100,
                limits,
                None,
                self.now(),
            )
        }
    }
    impl Probe for Scripted {
        fn now(&self) -> Instant {
            self.at.get()
        }
        fn leader(&self, group: u32) -> Result<Option<Process>> {
            Ok(self.present.then_some(Process {
                state: if self.busy { 'R' } else { 'S' },
                group,
                session: group,
                running: true,
                busy: self.busy,
                started: 7,
                cpu: self.cpu.get(),
            }))
        }
        fn group_cpu(&self, _: u32) -> Result<u64> {
            Ok(self.cpu.get() + self.descendant_cpu.get())
        }
        fn busy(&self, _: u32, leader: &Process) -> Result<bool> {
            Ok(leader.busy)
        }
    }
    #[test]
    fn supplied_progress_and_busy_threads_survive_arbitrarily_long_wall_gaps() {
        for advances_cpu in [false, true] {
            let probe = Scripted::new(true);
            let mut watch = probe.watch(Limits {
                cpu_seconds: 30.0,
                idle: Duration::from_secs(2),
            });
            // No host wait: this represents a runnable child starved of CPU
            // by siblings for many inactivity intervals, then making progress.
            for _ in 0..10 {
                probe.advance(Duration::from_secs(21));
                if advances_cpu {
                    probe.cpu.set(probe.cpu.get() + 210);
                }
                assert!(watch.sample(&probe, 42, (7, 42), None).unwrap().is_none());
            }
        }
    }
    #[test]
    fn supplied_sleep_without_progress_reaches_inactivity_and_exit_is_not_a_hang() {
        let mut probe = Scripted::new(false);
        let idle = Duration::from_secs(60);
        let mut watch = probe.watch(Limits {
            cpu_seconds: 30.0,
            idle,
        });
        probe.advance(idle / 2);
        assert!(watch.sample(&probe, 42, (7, 42), None).unwrap().is_none());
        probe.advance(idle / 2);
        assert!(matches!(
            watch
                .sample(&probe, 42, (7, 42), None)
                .unwrap()
                .unwrap()
                .kind,
            IncompleteKind::Hung
        ));
        probe.present = false;
        probe.advance(idle);
        assert!(
            watch.sample(&probe, 42, (7, 42), None).unwrap().is_none(),
            "the exit event, not inactivity, finishes an exited child"
        );
    }
    #[test]
    fn running_waiting_and_kernel_held_threads_are_busy_and_sleeping_ones_are_not() {
        let stat = |state: &str| {
            format!("42 (node) {state} 1 42 42 0 -1 4194304 0 0 0 0 1 2 0 0 20 0 1 0 7 0 0")
        };
        for (state, busy) in [("R", true), ("D", true), ("S", false), ("I", false)] {
            let record = process(&stat(state)).unwrap().unwrap();
            assert_eq!(record.busy, busy, "a thread in {state}");
            assert_eq!((record.group, record.started, record.cpu), (42, 7, 3));
        }
    }

    #[test]
    fn supplied_cpu_budget_is_runaway_even_when_every_thread_is_busy() {
        let probe = Scripted::new(true);
        let mut watch = probe.watch(Limits {
            cpu_seconds: 0.1,
            idle: Duration::from_secs(60),
        });
        probe.advance(Duration::from_secs(1));
        probe.cpu.set(20);
        assert!(matches!(
            watch
                .sample(&probe, 42, (7, 42), None)
                .unwrap()
                .unwrap()
                .kind,
            IncompleteKind::Runaway
        ));
    }
    #[test]
    fn supplied_descendant_cpu_and_output_activity_use_the_same_clock() {
        let probe = Scripted::new(false);
        let idle = Duration::from_secs(60);
        let mut watch = probe.watch(Limits {
            cpu_seconds: 30.0,
            idle,
        });
        probe.advance(idle / 2);
        watch.activity(probe.now());
        probe.advance(idle / 2);
        assert!(watch.sample(&probe, 42, (7, 42), None).unwrap().is_none());
        probe.advance(idle / 2);
        assert!(matches!(
            watch
                .sample(&probe, 42, (7, 42), None)
                .unwrap()
                .unwrap()
                .kind,
            IncompleteKind::Hung
        ));
        let mut watch = probe.watch(Limits {
            cpu_seconds: 1.0,
            idle,
        });
        probe.advance(Duration::from_secs(5));
        probe.descendant_cpu.set(101);
        let result = watch.sample(&probe, 42, (7, 42), None).unwrap().unwrap();
        assert!(matches!(result.kind, IncompleteKind::Runaway));
        assert!(result.reason.contains("owned command group"));
    }
    #[test]
    fn cleanup_success_and_failure_are_terminal_without_observing_again() {
        for failure in [false, true] {
            let mut state = CleanupState::Pending;
            let mut attempts = 0;
            let first = state
                .run(42, || {
                    attempts += 1;
                    if failure {
                        anyhow::bail!("retained cause");
                    }
                    Ok(())
                })
                .err()
                .map(|error| error.to_string());
            let second = state
                .run(42, || panic!("terminal cleanup observed or waited again"))
                .err()
                .map(|error| error.to_string());
            assert_eq!(first, second);
            assert_eq!(attempts, 1);
            if let Some(error) = first {
                for expected in ["INSTRUMENT", "group 42", "retained cause"] {
                    assert!(error.contains(expected));
                }
            }
        }
    }
    struct CleanupScript {
        at: Instant,
        steps: std::collections::VecDeque<(Duration, Vec<RemainingProcess>)>,
        pauses: usize,
    }
    impl CleanupObserver for CleanupScript {
        fn now(&self) -> Instant {
            self.at
        }
        fn members(&mut self, _: u32) -> Result<Vec<RemainingProcess>> {
            let (advance, members) = self
                .steps
                .pop_front()
                .expect("scripted cleanup observation");
            self.at += advance;
            Ok(members)
        }
        fn pause(&mut self) {
            self.pauses += 1;
        }
    }
    #[test]
    fn supplied_cleanup_can_drain_slowly_but_a_wedged_group_names_what_remains() {
        let member = RemainingProcess {
            pid: 43,
            state: 'D',
            started: 7,
        };
        let mut slow = CleanupScript {
            at: Instant::now(),
            steps: [
                (Duration::from_secs(4), vec![member.clone()]),
                (Duration::from_secs(1), vec![]),
            ]
            .into(),
            pauses: 0,
        };
        wait_for_cleanup(42, &mut slow).unwrap();
        assert_eq!(slow.pauses, 1);
        let mut stuck = CleanupScript {
            at: Instant::now(),
            steps: [(CLEANUP_WEDGE_BOUND, vec![member])].into(),
            pauses: 0,
        };
        let error = CleanupState::Pending
            .run(42, || wait_for_cleanup(42, &mut stuck))
            .unwrap_err()
            .to_string();
        for expected in [
            "INSTRUMENT",
            "group 42",
            "wedged-cleanup bound",
            "43:D",
            "start 7",
        ] {
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn ready_owned_group_drains_after_its_leader_exits_and_a_late_observation() {
        use std::io::BufRead as _;
        use std::os::unix::process::CommandExt as _;
        let child = Command::new("python3")
            .args([
                "-u",
                "-c",
                r"import os,signal,sys
r,w=os.pipe()
p=os.fork()
if p==0:
 os.close(r)
 fd=os.open('/dev/null',os.O_WRONLY)
 os.dup2(fd,1);os.dup2(fd,2)
 os.write(w,b'1');os.close(w)
 signal.pause()
else:
 os.close(w);os.read(r,1);os.close(r)
 print('ready',p,flush=True)
 sys.stdin.readline()
",
            ])
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut owned = OwnedChild {
            pid: child.id(),
            child: Some(child),
            identity: None,
            cleanup: CleanupState::Pending,
        };
        let output = owned.child.as_mut().unwrap().stdout.take().unwrap();
        let mut ready = String::new();
        std::io::BufReader::new(output)
            .read_line(&mut ready)
            .unwrap();
        let descendant = ready
            .trim()
            .strip_prefix("ready ")
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let identity = process_at(owned.pid).unwrap().unwrap();
        owned.identity = Some((identity.started, identity.session));
        let mut release = owned.child.as_mut().unwrap().stdin.take().unwrap();
        release.write_all(b"exit\n").unwrap();
        drop(release);
        assert!(owned.child.as_mut().unwrap().wait().unwrap().success());
        owned.child.take();
        let members = group_members(owned.pid).unwrap();
        assert!(members.iter().any(|member| member.pid == descendant));
        struct DelayedKernel {
            stale: Option<Vec<RemainingProcess>>,
            offset: Duration,
            observed_late: bool,
        }
        impl CleanupObserver for DelayedKernel {
            // Real time is only the five-minute wiring hang guard. The
            // delayed observation crosses the old bound on supplied time.
            fn now(&self) -> Instant {
                Instant::now() + self.offset
            }
            fn members(&mut self, group: u32) -> Result<Vec<RemainingProcess>> {
                if let Some(stale) = self.stale.take() {
                    self.offset = Duration::from_secs(4);
                    self.observed_late = true;
                    Ok(stale)
                } else {
                    group_members(group)
                }
            }
            fn pause(&mut self) {
                LiveCleanup.pause();
            }
        }
        let mut observer = DelayedKernel {
            stale: Some(members),
            offset: Duration::ZERO,
            observed_late: false,
        };
        owned.finish_with(&mut observer).unwrap();
        assert!(observer.observed_late);
        assert!(matches!(owned.cleanup, CleanupState::Finished));
        assert!(group_members(owned.pid).unwrap().is_empty());
        assert!(
            process_at(descendant)
                .unwrap()
                .is_none_or(|process| !process.running)
        );
    }

    #[test]
    fn call_boundaries_require_complete_ordered_cases() {
        let mut calls = Boundaries {
            next: 3,
            total: 5,
            ..Boundaries::default()
        };
        assert!(calls.observe("v1 begin 3 42", 1, 100).is_err());
        calls.observe("v1 ready 3 42", 1, 100).unwrap();
        assert!(calls.observe("v1 ready 3 42", 1, 100).is_err());
        calls.observe("v1 begin 3 42", 2, 100).unwrap();
        assert!(calls.observe("v1 end 4 42", 3, 100).is_err());
        calls.observe("v1 end 3 42", 3, 100).unwrap();
        assert!(calls.observe("v1 done 4 42", 4, 100).is_err());
        calls.observe("v1 begin 4 42", 4, 100).unwrap();
        assert!(calls.observe("v1 end 4 42", 2, 100).is_err());
        calls.observe("v1 end 4 42", 5, 100).unwrap();
        calls.observe("v1 done 5 42", 6, 100).unwrap();
        assert_eq!(calls.completed, 2);
        assert!(calls.done);
        assert!(calls.observe("v1 begin 5 42", 7, 100).is_err());
    }

    #[test]
    fn the_jvm_keeps_an_unwrapped_exception_with_events_enabled_or_unset() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-jvm-call-observer");
        std::fs::create_dir_all(root.join("nts/gen")).unwrap();
        let source = root.join("nts/gen/Program.java");
        std::fs::write(&source,"package nts.gen; public class Program {public static double work(double n) {if(n==0)throw new IllegalStateException(\"kept cause\");return n;}}").unwrap();
        assert!(
            nts_codegen_jvm::toolchain::command("javac")
                .args(["--release", "8", "-d"])
                .arg(&root)
                .arg(source)
                .status()
                .unwrap()
                .success()
        );
        let jar = root.join("runtime.jar");
        std::fs::write(&jar, nts_codegen_jvm::RUNTIME_JAR).unwrap();
        let cases = root.join("cases.txt");
        std::fs::write(
            &cases,
            "nts-check v2 work work 0 D - D 1\nnts-check v2 work work 1 D - D 0\n",
        )
        .unwrap();
        for enabled in [false, true] {
            let results = root.join(format!("results-{enabled}.txt"));
            let mut child = nts_codegen_jvm::toolchain::command("java");
            child
                .arg("-cp")
                .arg(format!("{}:{}", root.display(), jar.display()))
                .args(["nts.rt.Check"])
                .arg(&cases)
                .env("NTS_DIFF_RESULTS", &results);
            let limits = Limits {
                cpu_seconds: 5.0,
                idle: CLEANUP_WEDGE_BOUND,
            };
            let finished = if enabled {
                run(child, Utf8Path::from_path(&results).unwrap(), 0, 2, limits)
            } else {
                command(child, limits)
            }
            .unwrap();
            assert_eq!(finished.output.status.code(), Some(1));
            assert!(finished.incomplete.is_none());
            let error = String::from_utf8(finished.output.stderr).unwrap();
            assert!(error.starts_with("java.lang.IllegalStateException: kept cause"));
            assert!(!error.contains("InvocationTargetException"));
            let rows = std::fs::read_to_string(results).unwrap();
            assert_eq!(rows.lines().count(), 1);
            assert!(rows.starts_with("work 0 "));
            assert!(!rows.contains("v1 "));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn process_fields_include_every_thread_and_waited_children() {
        let mut fields = vec!["0"; 22];
        fields[0] = "S";
        fields[2] = "321";
        fields[3] = "100";
        fields[11] = "11";
        fields[12] = "13";
        fields[13] = "17";
        fields[14] = "19";
        fields[19] = "23";
        let record = process(&format!("321 (name with ) spaces) {}", fields.join(" ")))
            .unwrap()
            .unwrap();
        assert_eq!(
            (record.group, record.session, record.started, record.cpu),
            (321, 100, 23, 60)
        );
        assert!(process("invalid").is_err());
    }

    #[test]
    fn a_captured_exiting_process_has_no_remaining_identity() {
        // Verbatim /proc/1840560/stat captured while an owned child exited
        // and was reaped, on Linux 7.2.11-arch1-1. The old unsigned parser
        // failed on field 5 (-1), holding an unrelated outcomes command.
        let raw = "1840560 (capture) X 0 -1 -1 0 -1 4227148 27 0 0 0 0 0 0 0 39 19 0 0 21665492 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 17 9 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n";
        assert!(process(raw).unwrap().is_none());
    }

    #[test]
    fn the_actual_c_driver_handshake_preserves_output_and_exit_status() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-call-observer");
        std::fs::create_dir(&root).unwrap();
        let source = root.join("driver.c");
        let binary = root.join("driver");
        std::fs::write(
            &source,
            format!(
                r#"
#include <stdio.h>
#include <stdlib.h>
{NATIVE}
int main(int argc, char **argv) {{
    if (!nts_check_activity_mark("ready", 0)) return 2;
    if (!nts_check_activity_mark("begin", 0)) return 2;
    puts("subject output");
    if (!nts_check_activity_mark("end", 0)) return 2;
    if (!nts_check_activity_mark("done", 1)) return 2;
    return argc > 1 ? atoi(argv[1]) : 0;
}}
"#
            ),
        )
        .unwrap();
        assert!(
            Command::new("cc")
                .arg(&source)
                .arg("-o")
                .arg(&binary)
                .status()
                .unwrap()
                .success()
        );
        for code in [0, 124] {
            let result_file = root.join(format!("results-{code}"));
            let mut command = Command::new(&binary);
            command.arg(code.to_string());
            let output = run(
                command,
                Utf8Path::from_path(&result_file).unwrap(),
                0,
                1,
                Limits {
                    cpu_seconds: 5.0,
                    idle: CLEANUP_WEDGE_BOUND,
                },
            )
            .unwrap();
            assert!(output.incomplete.is_none());
            let output = output.output;
            assert_eq!(output.status.code(), Some(code));
            assert_eq!(output.stdout, b"subject output\n");
            assert_eq!(output.stderr, b"");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
