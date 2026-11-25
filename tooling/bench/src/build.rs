//! Build tools share the gate's CPU policy and process supervision.
use anyhow::{Context, Result};
use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

/// One compiled wait4 adapter for the run. Its private reports and executable
/// stay alive until all row recorders and supervised commands have drained.
#[derive(Debug)]
pub(super) struct Session {
    root: Utf8PathBuf,
    awfy: Option<Utf8PathBuf>,
    directory: crate::scratch::ScratchDir,
    next: AtomicU64,
}
impl Session {
    pub(super) fn new(root: &Utf8Path) -> Result<Self> {
        let awfy = crate::references::awfy_source(root)?;
        let directory = crate::scratch::ScratchDir::path_in_target("bench-build-usage");
        std::fs::create_dir(&directory)?;
        let output = Command::new("node")
            .arg(root.join("tooling/gate/case-bound.ts"))
            .arg("--prepare-build-observer")
            .arg(directory.as_str())
            .output()?;
        if !output.status.success() {
            return Err(NotMeasured(String::from_utf8_lossy(&output.stderr).into_owned()).into());
        }
        let descriptor: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        anyhow::ensure!(
            descriptor["directory"] == directory.as_str()
                && descriptor["binary"] == directory.join("phase-child").as_str(),
            "unexpected waited build observer"
        );
        Ok(Self {
            root: root.to_owned(),
            awfy,
            directory,
            next: AtomicU64::new(0),
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(super) enum Stage {
    External {
        column: String,
        phase: String,
        receipt: serde_json::Value,
    },
    Thread {
        column: String,
        phase: String,
        cpu_s: f64,
        basis: String,
        complete: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct Details {
    version: u8,
    stages: Vec<Stage>,
}

#[derive(Debug)]
pub(super) struct Recorder<'a> {
    session: &'a Session,
    stages: Vec<Stage>,
}
impl<'a> Recorder<'a> {
    pub(super) fn awfy(&self) -> Option<&Utf8Path> {
        self.session.awfy.as_deref()
    }
    pub(super) fn new(session: &'a Session) -> Self {
        Self {
            session,
            stages: Vec::new(),
        }
    }
    pub(super) fn finish(self) -> Details {
        Details {
            version: 1,
            stages: self.stages,
        }
    }
    pub(super) fn link_output(
        &mut self,
        column: &str,
        phase: &str,
        tool: &mut Command,
    ) -> Result<Output> {
        with_link_directory(tool, |tool| self.output(column, phase, tool))
    }
    pub(super) fn output(
        &mut self,
        column: &str,
        phase: &str,
        tool: &mut Command,
    ) -> Result<Output> {
        let report = self.session.directory.join(format!(
            "stage-{}.json",
            self.session.next.fetch_add(1, Ordering::Relaxed)
        ));
        let result = supervised(
            &self.session.root,
            tool,
            Some((&self.session.directory, &report)),
        );
        let receipt = (|| -> Result<serde_json::Value> {
            let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&report)?)?;
            anyhow::ensure!(
                value["version"] == 1
                    && value["command"] == tool.get_program().to_string_lossy().as_ref(),
                "build receipt belongs to another command"
            );
            let args: Vec<_> = tool
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            anyhow::ensure!(
                value["args"] == serde_json::to_value(args)?,
                "build receipt arguments changed"
            );
            Ok(value)
        })();
        match receipt {
            Ok(receipt) => self.stages.push(Stage::External {
                column: column.into(),
                phase: phase.into(),
                receipt,
            }),
            Err(error) => {
                return Err(NotMeasured(format!(
                    "build usage unavailable: {error:#}; command result: {result:?}"
                ))
                .into());
            }
        }
        result
    }
    /// The caller thread performs capture/prepare/emission sequentially.
    /// Shared checker processes and their worker threads are excluded.
    pub(super) fn thread<T>(
        &mut self,
        column: &str,
        phase: &str,
        work: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let before = thread_cpu()?;
        let result = work();
        let cpu_s = thread_cpu()? - before;
        anyhow::ensure!(
            cpu_s.is_finite() && cpu_s >= 0.,
            "thread CPU moved backwards"
        );
        self.stages.push(Stage::Thread {
            column: column.into(),
            phase: phase.into(),
            cpu_s,
            basis: "getrusage-RUSAGE_THREAD-v1; shared checker CPU excluded".into(),
            complete: result.is_ok(),
        });
        result
    }
}

fn thread_cpu() -> Result<f64> {
    use nix::sys::{
        resource::{UsageWho, getrusage},
        time::TimeValLike,
    };
    let usage = getrusage(UsageWho::RUSAGE_THREAD)
        .map_err(|error| NotMeasured(format!("cannot read thread CPU: {error}")))?;
    let micros = u64::try_from(
        usage.user_time().num_microseconds() + usage.system_time().num_microseconds(),
    )
    .map_err(|error| NotMeasured(format!("invalid thread CPU: {error}")))?;
    Ok(std::time::Duration::from_micros(micros).as_secs_f64())
}

#[derive(Debug)]
pub(super) struct Timeout(String);

impl std::fmt::Display for Timeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "timed out building: {}", self.0)
    }
}

impl std::error::Error for Timeout {}

#[derive(Debug)]
pub(super) struct NotMeasured(pub(super) String);

impl std::fmt::Display for NotMeasured {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "benchmark build not measured: {}", self.0)
    }
}
impl std::error::Error for NotMeasured {}

/// Keep the tool's arguments, cwd and explicit environment intact. The shared
/// supervisor owns the build session, including a driver's linker children.
#[cfg(test)]
pub(super) fn output(root: &Utf8Path, tool: &mut Command) -> Result<Output> {
    supervised(root, tool, None)
}

fn supervised(
    root: &Utf8Path,
    tool: &mut Command,
    usage: Option<(&Utf8Path, &Utf8Path)>,
) -> Result<Output> {
    let mut command = Command::new("node");
    command
        .arg(root.join("tooling/gate/case-bound.ts"))
        .arg("--build");
    if let Some((observer, report)) = usage {
        command
            .arg("--observer-directory")
            .arg(observer)
            .arg("--usage-report")
            .arg(report);
    }
    command
        .arg("--")
        .arg(tool.get_program())
        .args(tool.get_args());
    if let Some(cwd) = tool.get_current_dir() {
        command.current_dir(cwd);
    }
    for (key, value) in tool.get_envs() {
        match value {
            Some(value) => {
                command.env(key, value);
            }
            None => {
                command.env_remove(key);
            }
        }
    }
    let result = command
        .output()
        .with_context(|| format!("supervising build {}", tool.get_program().display()))?;
    if result.status.code() == Some(124)
        && String::from_utf8_lossy(&result.stderr)
            .lines()
            .any(|line| line.starts_with("not measured: "))
    {
        return Err(NotMeasured(format!(
            "{} {:?}\n{}{}",
            tool.get_program().display(),
            tool.get_args().collect::<Vec<_>>(),
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        ))
        .into());
    }
    if result.status.code() == Some(125)
        && String::from_utf8_lossy(&result.stderr)
            .lines()
            .any(|line| line.starts_with("timed out: "))
    {
        return Err(Timeout(format!(
            "{} {:?}\n{}{}",
            tool.get_program().display(),
            tool.get_args().collect::<Vec<_>>(),
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        ))
        .into());
    }
    Ok(result)
}

#[cfg(test)]
pub(super) fn link_output(root: &Utf8Path, tool: &mut Command) -> Result<Output> {
    with_link_directory(tool, |tool| output(root, tool))
}

/// GNU ld's libgcc script probes cwd for `libgcc_s.so.1`. This lookup belongs
/// to a fresh owned directory, including outside a test runner. All object,
/// library and output arguments are absolute when the benchmark calls this.
fn with_link_directory(
    tool: &mut Command,
    run: impl FnOnce(&mut Command) -> Result<Output>,
) -> Result<Output> {
    let directory = crate::scratch::ScratchDir::in_target("benchmark-link");
    run(tool.current_dir(&directory))
}

#[cfg(test)]
mod tests {
    use super::*;
    use camino::Utf8PathBuf;

    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    struct Fixture {
        root: Utf8PathBuf,
        dir: crate::scratch::ScratchDir,
        bin: Utf8PathBuf,
        driver: Utf8PathBuf,
    }

    fn fixture() -> Result<Fixture> {
        let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = crate::scratch::ScratchDir::path_in_target(&format!(
            "nts-bench-build-bound-{}",
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir)?;
        let own = Fixture {
            root: root.clone(),
            dir: dir.share(),
            bin: dir.join("bin"),
            driver: dir.join("fake-toolchain.py"),
        };
        let active = root
            .join("tooling/gate/active-command.ts")
            .canonicalize_utf8()?;
        let active = serde_json::to_string(&format!("file://{active}"))?;
        let observations = root
            .join("tooling/gate/command-observations-fixture.ts")
            .canonicalize_utf8()?;
        let observations = serde_json::to_string(&format!("file://{observations}"))?;
        let preload = dir.join("bound.mjs");
        std::fs::write(
            &preload,
            format!(
                r"import {{mock}} from 'node:test';
import {{writeFileSync}} from 'node:fs';
const real=await import({active});
const {{scriptedCommand,commandSample}}=await import({observations});
mock.module({active},{{namedExports:{{...real,activeCommand:async(command,args,options)=>{{
  if(options.eachProcessCpuSeconds!==real.COMPILE_CPU_BOUND_SECONDS)throw Error('build did not request the shared compile bound');
  if(options.idleMs!==real.COMMAND_IDLE_GUARD_MS)throw Error('build did not request the shared inactivity guard');
  const [driver,marker,mode]=args;
  if(!driver.endsWith('fake-toolchain.py'))throw Error('build changed the tool arguments');
  let samples=[commandSample(0)],result={{}};
  if(mode==='spin'){{
    const ticks=(real.COMPILE_CPU_BOUND_SECONDS+1)*100;
    samples=[commandSample(1,{{cpu:ticks,processOwn:{{pid:51,cpu:ticks}}}})];
    result={{stderr:'partial compiler diagnostic'}};
  }}else if(mode==='idle'){{
    samples=[commandSample(real.COMMAND_IDLE_GUARD_MS)];
    result={{stderr:'partial compiler diagnostic'}};
  }}else if(mode.startsWith('exit')){{
    result={{status:Number(mode.slice(4)),stderr:'ordinary compiler failure\n'}};
  }}else if(mode==='complete'){{
    writeFileSync(marker,options.env.BUILD_SENTINEL+'|'+options.cwd+'|'+String('HOME' in options.env).replace('false','False'));
  }}else throw Error('unknown fixed build observation '+mode);
  return scriptedCommand(command,options,samples,result);
}}}}}});
"
            ),
        )?;
        let node = Command::new("node")
            .args(["-p", "process.execPath"])
            .output()?;
        assert!(node.status.success());
        let node = String::from_utf8(node.stdout)?.trim().to_owned();
        let bin = dir.join("bin");
        std::fs::create_dir(&bin)?;
        let wrapper = bin.join("node");
        std::fs::write(
            &wrapper,
            format!(
                "#!/usr/bin/python3\nimport os,sys\nos.execv({node},[{node},'--experimental-test-module-mocks','--import',{preload},*sys.argv[1:]])\n",
                node = serde_json::to_string(&node)?,
                preload = serde_json::to_string(preload.as_str())?
            ),
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755))?;
        }
        let driver = dir.join("fake-toolchain.py");
        // Decision fixtures never execute a tool: the shared liveness model
        // consumes their supplied counters and clock above.
        std::fs::write(
            &driver,
            "raise RuntimeError('decision fixture executed a real tool')\n",
        )?;
        Ok(own)
    }

    impl Fixture {
        fn tool(&self, mode: &str) -> Result<Command> {
            let mut tool = Command::new("python3");
            tool.arg(&self.driver)
                .arg(self.dir.join("next built"))
                .arg(mode)
                .current_dir(&self.dir)
                .env("PATH", format!("{}:{}", self.bin, std::env::var("PATH")?))
                .env_remove("NODE_OPTIONS")
                .env("NTS_GATE_STEP_RESULT", self.dir.join("result.json"))
                .env("NTS_GATE_STEP", "benches")
                .env("NTS_GATE_STEP_ATTEMPT", "bound")
                .env("BUILD_SENTINEL", "kept")
                .env_remove("HOME");
            Ok(tool)
        }
    }

    #[test]
    fn link_cwd_is_owned_and_removed_with_and_without_the_test_runner() -> Result<()> {
        let own = fixture()?;
        let marker = own.dir.join("next built");
        let mut tool = own.tool("complete")?;
        assert!(link_output(&own.root, &mut tool)?.status.success());
        let text = std::fs::read_to_string(marker)?;
        let cwd = Utf8PathBuf::from(text.split('|').nth(1).expect("recorded cwd"));
        let parent = crate::scratch::target_parent();
        assert!(cwd.starts_with(parent.canonicalize_utf8()?), "{cwd}");
        assert!(!cwd.exists(), "link cwd must be removed after drain: {cwd}");
        if std::env::var_os("NTS_BENCH_LINK_CWD_FALLBACK_CONTROL").is_none() {
            crate::self_test::run(
                "build::tests::link_cwd_is_owned_and_removed_with_and_without_the_test_runner",
                |command| {
                    command
                        .env_remove("NTS_TEST_SCRATCH_ROOT")
                        .env("NTS_BENCH_LINK_CWD_FALLBACK_CONTROL", "1");
                },
            );
        }
        Ok(())
    }

    #[test]
    fn a_spinning_linker_records_a_build_failure_and_the_next_case_runs() -> Result<()> {
        let own = fixture()?;
        let Fixture { root, dir, .. } = &own;
        let marker = dir.join("next built");
        let mut failures = std::collections::BTreeMap::new();
        let mut failed = Vec::new();
        let mut completed = Vec::new();
        for (name, mode) in [("a-spin", "spin"), ("b-next", "complete")] {
            let mut tool = own.tool(mode)?;
            let result = output(root, &mut tool);
            if mode == "spin" {
                assert!(
                    result
                        .as_ref()
                        .expect_err("the fake linker must time out")
                        .is::<Timeout>(),
                    "{result:?}"
                );
            } else {
                assert!(
                    result
                        .as_ref()
                        .expect("the next build must complete")
                        .status
                        .success(),
                    "{result:?}"
                );
            }
            if crate::accept_build(name, result, &mut failures, &mut failed)?.is_some() {
                completed.push(name);
            }
        }
        assert_eq!(completed, ["b-next"]);
        assert_eq!(
            std::fs::read_to_string(marker)?,
            format!("kept|{dir}|False")
        );
        let rows = serde_json::to_value(&failures)?;
        assert_eq!(rows["a-spin"]["kind"], "build_failed");
        let reason = rows["a-spin"]["reason"]
            .as_str()
            .expect("recorded failure has a reason");
        assert!(reason.starts_with("timed out building:"), "{reason}");
        assert!(
            reason.contains("process ") && reason.contains("own CPU reached"),
            "{reason}"
        );
        assert!(!failures.contains_key("b-next"));
        assert_eq!(failed.len(), 1);
        assert!(
            !dir.join("result.json").exists(),
            "a case timeout must not hold the step"
        );
        assert!(
            crate::require_valid_rows(&failed).is_err(),
            "the recorded failure must leave the run red"
        );
        Ok(())
    }
    #[test]
    fn bare_reserved_exits_are_ordinary_tool_failures() -> Result<()> {
        let own = fixture()?;
        for code in [124, 125] {
            let result = output(&own.root, &mut own.tool(&format!("exit{code}"))?)?;
            assert_eq!(result.status.code(), Some(code));
            assert!(String::from_utf8_lossy(&result.stderr).contains("ordinary compiler failure"));
        }
        assert!(!own.dir.join("result.json").exists());
        Ok(())
    }

    #[test]
    fn a_silent_build_is_unmeasured_and_never_becomes_a_row() -> Result<()> {
        let own = fixture()?;
        let result = output(&own.root, &mut own.tool("idle")?).context("running fake compiler");
        assert!(
            result
                .as_ref()
                .expect_err("idle build must hold")
                .is::<NotMeasured>()
        );
        let frame: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(own.dir.join("result.json"))?)?;
        assert_eq!(frame["kind"], "hung");
        assert_eq!(frame["verdict"], "NOT RUN");
        let mut failures = std::collections::BTreeMap::new();
        let mut failed = Vec::new();
        let held = crate::accept_build("silent", result, &mut failures, &mut failed);
        assert!(
            held.expect_err("unmeasured must stop the run")
                .is::<NotMeasured>()
        );
        assert!(failures.is_empty());
        assert_eq!(failed, Vec::<String>::new());
        Ok(())
    }

    #[test]
    fn missing_awfy_skips_both_reference_compilers_and_retains_one_reason() -> Result<()> {
        let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut session = Session::new(&root)?;
        session.awfy = None;
        let mut recorder = Recorder::new(&session);
        let out = crate::scratch::ScratchDir::path_in_target("awfy-unavailable");
        std::fs::create_dir(&out)?;
        let case = root.join("benchmarks/cases/awfy-bounce");
        let workload = serde_json::from_value(
            serde_json::json!({"roots":["work"],"numeric":{"callee":"work","seed":1.0}}),
        )?;
        let (cells, absent) = crate::variants(
            &root,
            &case,
            &out,
            "awfy-bounce",
            &case.join("tsconfig.json"),
            nts_core::hir::Memory::ReferenceCounting,
            &[],
            &out.join("unused.c"),
            &out.join("unused-plain.c"),
            &out.join("unused.ll"),
            crate::Emission {
                renderable: false,
                initializes: false,
                needs_unicode: false,
                refused: Some("work"),
            },
            &workload,
            None,
            &mut recorder,
        )?;
        assert!(cells.iter().all(Option::is_none));
        let reason = absent.cpp.context("missing C++ corpus reason")?;
        assert!(reason.contains("awfy.ts --acquire"));
        assert_eq!(absent.java.as_deref(), Some(reason.as_str()));
        assert!(
            recorder.finish().stages.is_empty(),
            "neither reference compiler started"
        );
        assert!(crate::references::corpus_absence(&case, "ref.cpp", true)?.is_none());
        assert!(crate::references::corpus_absence(&case, "ref.java", true)?.is_none());
        Ok(())
    }

    #[test]
    fn row_build_recorder_keeps_success_failure_and_thread_accounting() -> Result<()> {
        let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let session = Session::new(&root)?;
        let mut recorder = Recorder::new(&session);
        for code in [0, 7] {
            let result=recorder.output("nts C","native control",Command::new("node").args(["-e",&format!("let x=0;for(let i=0;i<5e6;i++)x^=i;process.stdout.write('answer:'+x);process.exitCode={code}")]))?;
            assert_eq!(result.status.code(), Some(code));
            assert_eq!(result.stdout, b"answer:0");
        }
        let answer = recorder.thread("nts C", "compiler control", || {
            let start = thread_cpu()?;
            let mut answer = 0;
            loop {
                for i in 0..1_000_000 {
                    answer ^= std::hint::black_box(i);
                }
                if thread_cpu()? > start {
                    break;
                }
            }
            Ok(answer)
        })?;
        assert_eq!(answer, 0);
        let failure = recorder.thread::<()>("nts LLVM", "failed compiler control", || {
            anyhow::bail!("retained failure")
        });
        assert!(
            failure
                .expect_err("the supplied compiler phase fails")
                .to_string()
                .contains("retained failure")
        );
        let details = serde_json::to_value(recorder.finish())?;
        assert_eq!(details["version"], 1);
        let stages = details["stages"].as_array().expect("stage inventory");
        assert_eq!(stages.len(), 4);
        for (stage, code) in stages[..2].iter().zip([0, 7]) {
            assert_eq!(stage["receipt"]["status"], code);
            assert_eq!(stage["receipt"]["waited"]["exit"], code);
            assert!(
                stage["receipt"]["waited"]["user_s"]
                    .as_f64()
                    .expect("waited user CPU")
                    + stage["receipt"]["waited"]["sys_s"]
                        .as_f64()
                        .expect("waited system CPU")
                    > 0.
            );
        }
        assert_eq!(
            stages[2]["basis"],
            "getrusage-RUSAGE_THREAD-v1; shared checker CPU excluded"
        );
        assert!(stages[2]["cpu_s"].as_f64().expect("calling thread CPU") > 0.);
        assert_eq!(stages[2]["complete"], true);
        assert_eq!(stages[3]["complete"], false);
        Ok(())
    }
}
