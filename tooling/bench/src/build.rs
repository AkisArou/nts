//! Build tools share the gate's CPU policy and process supervision.
use anyhow::{Context, Result};
use camino::Utf8Path;
use std::process::{Command, Output};

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
pub(super) fn output(root: &Utf8Path, tool: &mut Command) -> Result<Output> {
    let mut command = Command::new("node");
    command
        .arg(root.join("tooling/gate/case-bound.ts"))
        .args(["--build", "--"])
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
}
