//! Observation-only prospective result keys for expensive benchmark checks.
//! Inputs are measured before execution and rechecked afterwards. Fresh results
//! always remain authoritative; the observer never supplies an execution result.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context as _, Result};
use camino::{Utf8Path, Utf8PathBuf};
use serde_json::{Value, json};

static REQUESTS: AtomicU64 = AtomicU64::new(0);

pub(crate) struct Pending {
    request: Value,
    key: Value,
}

fn enabled() -> bool {
    std::env::var("NTS_GATE_STEP").as_deref() == Ok("bench-agree")
        && std::env::var_os("NTS_GATE_SHADOW_DIR").is_some_and(|value| !value.is_empty())
        && std::env::var_os("NTS_GATE_CASE_COSTS_DIR").is_some()
}

fn begin(
    kind: &str,
    files: Vec<(String, Utf8PathBuf)>,
    absent: Vec<Utf8PathBuf>,
    tools: Vec<String>,
    values: Value,
) -> Option<Pending> {
    if !enabled() {
        return None;
    }
    let mut request = json!({"kind":kind,"mode":"prepare","context":super::case_costs::project_context(),
        "files":files.into_iter().map(|(name,path)| json!({"name":name,"path":path})).collect::<Vec<_>>(),
        "values":{"differential_harness":include_str!("lib.rs"),"cwd":std::env::current_dir().ok()}});
    request["absent"] = Value::Array(absent.into_iter().map(|path| json!(path)).collect());
    request["tools"] = Value::Array(tools.into_iter().map(Value::String).collect());
    request["values"]["options"] = values;
    let key = invoke(&request, "shadow.prepare")
        .ok()
        .and_then(|row| row.get("key").cloned())
        .unwrap_or(Value::Null);
    Some(Pending { request, key })
}

impl Pending {
    fn finish(mut self, result: Value) {
        self.request["mode"] = "finish".into();
        self.request["expected_key"] = self.key;
        self.request["result"] = result;
        let kind = self.request["kind"].as_str().unwrap_or("unknown");
        match invoke(&self.request, "shadow.observe") {
            Ok(row) if row["event"] == "artifact.shadow" => {}
            Ok(_) => unavailable(kind, "shadow observer returned no observation"),
            Err(error) => unavailable(kind, &error.to_string()),
        }
    }
}

pub(crate) fn jvm(
    dir: &Utf8Path,
    emitted: &nts_codegen_jvm::Emitted,
    jar: &Utf8Path,
    cases: &Utf8Path,
) -> Option<Pending> {
    if !enabled() {
        return None;
    }
    let mut files = emitted
        .classes
        .iter()
        .map(|class| (format!("program:{}", class.path()), dir.join(class.path())))
        .collect::<Vec<_>>();
    files.push(("runtime-jar".into(), jar.into()));
    files.push(("hostile-pool-driver".into(), cases.into()));
    let java = std::env::var("JAVA_HOME")
        .map_or_else(|_| "java".into(), |home| format!("{home}/bin/java"));
    begin(
        "bench-program-jvm",
        files,
        Vec::new(),
        vec![java, "timeout".into()],
        json!({"timeout":super::TIMEOUT,"flags":(["-Xmx512m","-XX:MaxMetaspaceSize=128m","-XX:TieredStopAtLevel=1"].into_iter().chain(nts_codegen_jvm::toolchain::vm_flags()).collect::<Vec<_>>())}),
    )
}

pub(crate) fn finish_jvm(
    pending: Option<Pending>,
    run: &Result<super::Run>,
    refused: &[usize],
    aborts: &[String],
    timeouts: usize,
) {
    if let Some(pending) = pending {
        pending.finish(
            json!({"run":outcome(run),"refused":refused,"aborts":aborts,"timeouts":timeouts}),
        );
    }
}

pub(crate) fn oracle(dir: &Utf8Path, sources: &[nts_diagnostics::SourceFile]) -> Option<Pending> {
    if !enabled() {
        return None;
    }
    let mut files = Vec::new();
    let mut manifests = std::collections::BTreeSet::new();
    for source in sources {
        files.push((
            format!("source:{}", source.display_path),
            source.display_path.clone(),
        ));
        for parent in source.display_path.ancestors().skip(1) {
            manifests.insert(parent.join("package.json"));
        }
    }
    let mut absent = Vec::new();
    for path in manifests {
        if path.exists() {
            files.push((format!("package:{path}"), path));
        } else {
            absent.push(path);
        }
    }
    files.push(("oracle-driver".into(), dir.join("check_driver.mjs")));
    files.push(("oracle-resolver".into(), dir.join("resolve_ts.mjs")));
    begin(
        "bench-oracle-node",
        files,
        absent,
        vec!["node".into(), "timeout".into(), "prlimit".into()],
        json!({"cpu_limit_s":super::oracle_coverage::CPU_SECONDS,"wall_limit_ms":super::oracle_coverage::WALL_MILLIS,"memory_mb":super::MEMORY_MB,"flags":["--experimental-transform-types","--import"],"supervisor":include_str!("oracle_run.rs")}),
    )
}

pub(crate) fn finish_oracle(
    pending: Option<Pending>,
    run: &Result<super::Run>,
    status: &Value,
    completion: &Value,
) {
    if let Some(pending) = pending {
        let mut result = outcome(run);
        result["oracle_status"] = status.clone();
        result["oracle_completion"] = completion.clone();
        pending.finish(result);
    }
}

fn outcome(run: &Result<super::Run>) -> Value {
    match run {
        Ok(run) => json!({"results":run.results,"output":run.output,"thrown":run.thrown}),
        Err(error) => json!({"error":format!("{error:#}")}),
    }
}

fn invoke(request: &Value, phase: &'static str) -> Result<Value> {
    let root = PathBuf::from(std::env::var("NTS_GATE_CASE_COSTS_DIR")?);
    let path = root.join(format!(
        "shadow-request-{}-{}.json",
        std::process::id(),
        REQUESTS.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&path, serde_json::to_vec(request)?)?;
    let helper = std::env::var_os("NTS_GATE_SHADOW_HELPER").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("../gate/artifact-shadow.ts"),
        PathBuf::from,
    );
    let observed = super::case_costs::child(phase, || {
        std::process::Command::new("node")
            .arg(helper)
            .arg("--request")
            .arg(&path)
            .output()
    });
    let _ = std::fs::remove_file(&path);
    let output = observed.context("running the artifact shadow observer")?;
    anyhow::ensure!(output.status.success(), "shadow observer failed");
    serde_json::from_slice(&output.stdout).context("shadow observer returned no observation")
}

fn unavailable(kind: &str, error: &str) {
    let Ok(root) = std::env::var("NTS_GATE_CASE_COSTS_DIR") else {
        return;
    };
    let path = Path::new(&root).join(format!(
        "shadow-{}-{}.jsonl",
        std::process::id(),
        REQUESTS.fetch_add(1, Ordering::Relaxed)
    ));
    let row = json!({"event":"artifact.shadow","kind":kind,"step":"bench-agree","status":"unavailable","key":null,
        "run":std::env::var("NTS_GATE_RUN_DIR").ok(),"error":error});
    let _ = std::fs::write(path, format!("{row}\n"));
}
