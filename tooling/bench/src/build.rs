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
        dir: Utf8PathBuf,
        bin: Utf8PathBuf,
        driver: Utf8PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).expect("remove private build fixture");
        }
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
            dir: dir.clone(),
            bin: dir.join("bin"),
            driver: dir.join("fake-toolchain.py"),
        };
        let active = root
            .join("tooling/gate/active-command.ts")
            .canonicalize_utf8()?;
        let active = serde_json::to_string(&format!("file://{active}"))?;
        let preload = dir.join("bound.mjs");
        std::fs::write(
            &preload,
            format!(
                r"import {{mock}} from 'node:test';
const real=await import({active});
mock.module({active},{{namedExports:{{...real,activeCommand:(command,args,options)=>{{
  if(options.eachProcessCpuSeconds!==real.COMPILE_CPU_BOUND_SECONDS)throw Error('build did not request the shared compile bound');
  return real.activeCommand(command,args,{{...options,eachProcessCpuSeconds:0.3,idleMs:200,pollMs:20}});
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
        std::fs::write(
            &driver,
            r"import os, pathlib, subprocess, sys
marker = pathlib.Path(sys.argv[1])
if sys.argv[2] == 'spin':
    print('partial compiler diagnostic',file=sys.stderr,end='',flush=True)
    subprocess.run([sys.executable, '-c', 'import os,pathlib,sys\npathlib.Path(sys.argv[1]).write_text(str(os.getpid()))\nwhile True: pass', str(marker.with_suffix('.pid'))], check=True)
elif sys.argv[2] == 'idle':
    print('partial compiler diagnostic',file=sys.stderr,end='',flush=True)
    import time
    time.sleep(60)
elif sys.argv[2].startswith('exit'):
    print('ordinary compiler failure', file=sys.stderr)
    sys.exit(int(sys.argv[2][4:]))
else:
    marker.write_text(os.environ['BUILD_SENTINEL'] + '|' + os.getcwd() + '|' + str('HOME' in os.environ))
",
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
                let pid = std::fs::read_to_string(marker.with_extension("pid"))?;
                match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
                    Ok(stat) => assert!(
                        stat.rsplit_once(") ")
                            .expect("kernel stat has a process name")
                            .1
                            .starts_with("Z "),
                        "the timed-out linker is still alive: {stat}"
                    ),
                    Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::NotFound),
                }
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
