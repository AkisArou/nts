//! Call boundaries belong to the trusted driver, separately from its answers.
//! The driver blocks at each boundary while its owner samples process
//! CPU, so a fast following call cannot be charged to the preceding one.

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
    group: u32,
    session: u32,
    running: bool,
    started: u64,
    cpu: u64,
}

fn process(text: &str) -> Result<Process> {
    let end = text.rfind(')').context("invalid process name")?;
    let fields: Vec<_> = text[end + 1..].split_whitespace().collect();
    let number = |at: usize| -> Result<u64> {
        fields
            .get(at)
            .context("missing process field")?
            .parse()
            .context("invalid process field")
    };
    Ok(Process {
        group: u32::try_from(number(2)?)?,
        session: u32::try_from(number(3)?)?,
        running: !matches!(fields[0], "Z" | "X"),
        started: number(19)?,
        cpu: [11, 12, 13, 14].into_iter().try_fold(0_u64, |sum, at| {
            sum.checked_add(number(at)?).context("process CPU overflow")
        })?,
    })
}

fn process_at(pid: u32) -> Result<Option<Process>> {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(text) => Ok(Some(process(&text)?)),
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
struct OwnedChild {
    child: Option<Child>,
    pid: u32,
    identity: Option<(u64, u32)>,
    finished: bool,
}

impl OwnedChild {
    fn finish(&mut self) -> Result<()> {
        if self.finished {
            return Ok(());
        }
        let group = self.pid;
        // The waiter can already have reaped the leader. Surviving members
        // retain this PGID, preventing its number from being reused; always
        // finish that owned group even after the leader's exit event.
        if let Some(now) = process_at(group)? {
            ensure!(
                now.group == group
                    && self
                        .identity
                        .is_none_or(|identity| (now.started, now.session) == identity),
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
        // Signal delivery precedes termination. Do not return while a helper
        // could still execute; an unreapable cleanup is an instrument error.
        let cleanup = Instant::now();
        while group_remains(group)? {
            ensure!(
                cleanup.elapsed() < Duration::from_secs(3),
                "owned compiled group did not finish cleanup"
            );
            thread::sleep(Duration::from_millis(5));
        }
        if let Some(child) = &mut self.child {
            child.wait()?;
        }
        self.finished = true;
        Ok(())
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

fn group_remains(group: u32) -> Result<bool> {
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        if let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
            && process_at(pid)?.is_some_and(|process| process.group == group && process.running)
        {
            return Ok(true);
        }
    }
    Ok(false)
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
    fn new(identity: &Process, hz: u32, limits: Limits, channel: Option<&Channel>) -> Self {
        let budget = channel.map_or(limits.cpu_seconds, |c| {
            let calls = u32::try_from(c.boundaries.total - c.boundaries.next).unwrap_or(u32::MAX);
            (limits.cpu_seconds * (f64::from(calls) + 1.0)).min(1800.0)
        });
        Self {
            hz,
            limits,
            last: Instant::now(),
            cpu: identity.cpu,
            group_at: Instant::now(),
            group_period: Duration::from_secs(5).min(limits.idle / 4),
            group_cpu: identity.cpu,
            group_budget: budget,
        }
    }
    fn sample(
        &mut self,
        group: u32,
        identity: (u64, u32),
        channel: Option<&Channel>,
    ) -> Result<Option<Incomplete>> {
        let now = Instant::now();
        if now.duration_since(self.group_at) >= self.group_period {
            let cpu = group_cpu(group)?;
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
        let Some(current) = process_at(group)? else {
            return Ok(None);
        };
        ensure!(
            (current.started, current.session) == identity && current.group == group,
            "supervised child identity changed"
        );
        if current.cpu != self.cpu {
            self.last = now;
            self.cpu = current.cpu;
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
                    "no output, completed call or process CPU activity for {} ms",
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
            finished: false,
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
        let watch = Watch::new(&identity, hz, limits, channel.as_ref());
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
                self.watch.last = Instant::now();
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
                self.watch.last = Instant::now();
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

    #[test]
    fn a_silent_busy_child_completes_past_the_old_twenty_second_wall_guard() {
        let child = node(
            "const start=process.cpuUsage();for(;;){const used=process.cpuUsage(start);if(used.user+used.system>=21_000_000)break;}",
        );
        let finished = command(
            child,
            Limits {
                cpu_seconds: 30.0,
                idle: Duration::from_secs(2),
            },
        )
        .unwrap();
        assert!(finished.output.status.success());
        assert!(finished.incomplete.is_none());
        assert_eq!(finished.output.stdout, b"");
    }

    #[test]
    fn idle_and_cpu_runaway_are_distinct_supervisor_observations() {
        let idle = command(
            node("setInterval(()=>{},1000)"),
            Limits {
                cpu_seconds: 5.0,
                idle: Duration::from_millis(200),
            },
        )
        .unwrap();
        assert!(matches!(
            idle.incomplete.unwrap().kind,
            IncompleteKind::Hung
        ));
        let busy = command(
            node("for(;;){}"),
            Limits {
                cpu_seconds: 0.1,
                idle: Duration::from_secs(5),
            },
        )
        .unwrap();
        assert!(matches!(
            busy.incomplete.unwrap().kind,
            IncompleteKind::Runaway
        ));
    }

    #[test]
    fn cleanup_stops_a_grandchild_even_after_its_leader_and_stdio_exit() {
        let mut child = Command::new("python3");
        child.args([
            "-c",
            r"import os,time
r,w=os.pipe()
p=os.fork()
if p==0:
 os.close(r)
 fd=os.open('/dev/null',os.O_WRONLY)
 os.dup2(fd,1);os.dup2(fd,2)
 os.write(w,b'1');os.close(w)
 while True: time.sleep(10)
else:
 os.close(w);os.read(r,1);os.close(r)
 print(p,flush=True)
",
        ]);
        let finished = command(
            child,
            Limits {
                cpu_seconds: 5.0,
                idle: Duration::from_secs(5),
            },
        )
        .unwrap();
        assert!(finished.output.status.success());
        let pid = String::from_utf8(finished.output.stdout)
            .unwrap()
            .trim()
            .parse::<u32>()
            .unwrap();
        if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            // PID 1 may not yet have reaped the killed orphan; it cannot run.
            assert_eq!(
                stat[stat.rfind(')').unwrap() + 1..]
                    .split_whitespace()
                    .next(),
                Some("Z")
            );
        }
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
        let root =
            std::env::temp_dir().join(format!("nts-jvm-call-observer-{}", std::process::id()));
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
                idle: Duration::from_secs(5),
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
        let record = process(&format!("321 (name with ) spaces) {}", fields.join(" "))).unwrap();
        assert_eq!(
            (record.group, record.session, record.started, record.cpu),
            (321, 100, 23, 60)
        );
        assert!(process("invalid").is_err());
    }

    #[test]
    fn the_actual_c_driver_handshake_preserves_output_and_exit_status() {
        let root = std::env::temp_dir().join(format!("nts-call-observer-{}", std::process::id()));
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
                    idle: Duration::from_secs(5),
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
