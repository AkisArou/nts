//! Persistent full-corpus workers. A compiler abort belongs to its input,
//! rather than aborting the parent and losing every other case's outcome.

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};

use anyhow::{Context, Result};
use camino::{Utf8Path, Utf8PathBuf};

use super::{Examined, Outcome, Workspace, examine};

pub(super) fn serve(root: &Utf8Path, worker: usize) -> Result<()> {
    let root = root.to_owned();
    let handle = std::thread::Builder::new()
        .name(format!("corpus-{worker}"))
        .stack_size(nts_core::COMPILER_STACK_BYTES)
        .spawn(move || -> Result<()> {
            let workspace = Workspace::open(&root, worker)?;
            let mut output = BufWriter::new(std::io::stdout().lock());
            for line in std::io::stdin().lock().lines() {
                let file: String = serde_json::from_str(&line?)?;
                let result = examine(Utf8Path::new(&file), &workspace);
                serde_json::to_writer(&mut output, &result)?;
                output.write_all(b"\n")?;
                output.flush()?;
            }
            Ok(())
        })
        .context("starting isolated compilation thread")?;
    match handle.join() {
        Ok(result) => result,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

struct Running {
    process: Child,
    input: Option<BufWriter<ChildStdin>>,
    output: BufReader<ChildStdout>,
}

impl Running {
    fn spawn(command: &mut Command) -> Result<Self> {
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut process = command.spawn().context("starting corpus worker process")?;
        Ok(Self {
            input: Some(BufWriter::new(process.stdin.take().expect("piped stdin"))),
            output: BufReader::new(process.stdout.take().expect("piped stdout")),
            process,
        })
    }

    fn request(&mut self, file: &Utf8Path) -> Result<Option<Examined>> {
        let input = self.input.as_mut().expect("live worker input");
        serde_json::to_writer(&mut *input, file.as_str())?;
        input.write_all(b"\n")?;
        input.flush()?;
        let mut line = String::new();
        if self.output.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        Ok(Some(
            serde_json::from_str(&line).context("corpus worker reply")?,
        ))
    }

    /// Stop only this owned process group, including any subprocess orphaned by an
    /// abort. The child PID is still reserved until wait reaps it.
    fn terminate(&mut self) {
        #[cfg(unix)]
        {
            let group = format!("-{}", self.process.id());
            let _ = Command::new("kill")
                .args(["-TERM", "--", &group])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.process.kill();
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        // Graceful EOF after the last successful reply. Failure paths have
        // already terminated the group before reaching this wait.
        drop(self.input.take());
        let _ = self.process.wait();
    }
}

pub(super) struct Worker {
    root: Utf8PathBuf,
    index: usize,
    running: Option<Running>,
    #[cfg(test)]
    mock_command: Option<Vec<String>>,
}

impl Worker {
    pub(super) fn new(root: &Utf8Path, index: usize) -> Self {
        Self {
            root: root.to_owned(),
            index,
            running: None,
            #[cfg(test)]
            mock_command: None,
        }
    }

    fn start(&self) -> Result<Running> {
        #[cfg(test)]
        if let Some(args) = &self.mock_command {
            let mut command = Command::new(&args[0]);
            command.args(&args[1..]).stderr(Stdio::null());
            return Running::spawn(&mut command);
        }
        let log = self
            .root
            .join(format!("target/suite/w{}/worker.stderr", self.index));
        let stderr = OpenOptions::new().create(true).append(true).open(&log)?;
        let mut command = Command::new(std::env::current_exe()?);
        command
            .args(["--root", self.root.as_str(), "--corpus-worker"])
            .arg(self.index.to_string())
            .env("NTS_CHECKERS", "1")
            .stderr(stderr);
        Running::spawn(&mut command)
    }

    pub(super) fn examine(&mut self, file: &Utf8Path) -> Examined {
        if self.running.is_none() {
            match self.start() {
                Ok(running) => self.running = Some(running),
                Err(error) => return failed(error.to_string()),
            }
        }
        let running = self.running.as_mut().expect("started worker");
        match running.request(file) {
            Ok(Some(result)) => result,
            reply => {
                // EOF commonly means SIGABRT; malformed replies and broken
                // pipes also fail explicitly. Respawn for the next file.
                running.terminate();
                let status = running.process.wait();
                let outcome = match status {
                    Ok(status) if !status.success() && reply.is_ok() => {
                        Outcome::Crashed(status_text(status))
                    }
                    status => Outcome::Failed(format!(
                        "corpus worker returned no result for `{file}`: {status:?}; {}",
                        reply
                            .err()
                            .map_or_else(|| "EOF".to_owned(), |error| error.to_string())
                    )),
                };
                self.running = None;
                Examined {
                    outcome,
                    notes: Vec::new(),
                    uncompilable: false,
                    unverifiable: false,
                }
            }
        }
    }
}

fn status_text(status: ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("signal {signal}");
        }
    }
    status.to_string()
}

fn failed(message: String) -> Examined {
    Examined {
        outcome: Outcome::Failed(message),
        notes: Vec::new(),
        uncompilable: false,
        unverifiable: false,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_dead_child_is_recorded_and_the_following_case_runs() {
        let cache = std::env::var("TMPDIR")
            .unwrap_or_else(|_| format!("{}/.cache", std::env::var("HOME").expect("home")));
        let root = Utf8PathBuf::from(cache).join(format!(
            "nts-corpus-respawn-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("private scratch");
        let trace = root.join("starts");
        let mut worker = Worker::new(&root, 0);
        worker.mock_command = Some(vec![
            "node".to_owned(),
            "--input-type=module".to_owned(),
            "-e".to_owned(),
            r"import fs from 'node:fs';
import readline from 'node:readline';
fs.appendFileSync(process.argv[1],process.pid+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 if(JSON.parse(line).endsWith('crash.ts'))process.kill(process.pid,'SIGKILL');
 else console.log(JSON.stringify({outcome:'Lowered',notes:[],uncompilable:false,unverifiable:false}));
});"
                .to_owned(),
            trace.to_string(),
        ]);
        assert!(matches!(
            worker.examine(Utf8Path::new("first.ts")).outcome,
            Outcome::Lowered
        ));
        let crash = worker.examine(Utf8Path::new("crash.ts"));
        assert!(matches!(crash.outcome, Outcome::Crashed(ref reason) if reason == "signal 9"));
        assert!(matches!(
            worker.examine(Utf8Path::new("last.ts")).outcome,
            Outcome::Lowered
        ));
        drop(worker);
        let starts = std::fs::read_to_string(trace).expect("worker starts");
        let starts: Vec<_> = starts.lines().collect();
        assert_eq!(starts.len(), 2, "successful cases reuse the process");
        assert_ne!(starts[0], starts[1], "a signal starts a new process");
        std::fs::remove_dir_all(root).expect("scratch cleanup");
    }
}
