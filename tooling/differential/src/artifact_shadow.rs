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
        "values":{"differential_harness":include_str!("lib.rs"),"output_protocol":include_str!("output.rs"),"cwd":std::env::current_dir().ok()}});
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
        vec![java],
        json!({"call_cpu_profile":super::CALL_BUDGETS,"supervisor":include_str!("call_activity.rs"),"flags":(["-Xmx512m","-XX:MaxMetaspaceSize=128m","-XX:TieredStopAtLevel=1"].into_iter().chain(nts_codegen_jvm::toolchain::vm_flags()).collect::<Vec<_>>())}),
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

pub(crate) fn oracle(
    dir: &Utf8Path,
    sources: &[nts_diagnostics::SourceFile],
    emitted: &super::oracle_emit::Prepared,
) -> Option<Pending> {
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
    files.extend(oracle_assets(emitted));
    files.push(("oracle-emit-manifest".into(), emitted.manifest.clone()));
    begin(
        "bench-oracle-node",
        files,
        absent,
        vec!["node".into(), "prlimit".into()],
        json!({"execution_policy":include_str!("../oracle-execution-policy.ts"),"idle_limit_ms":super::oracle_coverage::IDLE_MILLIS,"memory_mb":super::MEMORY_MB,"flags":emitted.args,"oracle_emit":emitted.identity,"oracle_owner":include_str!("oracle_emit.rs"),"supervisor":include_str!("oracle_run.rs")}),
    )
}

fn oracle_assets(emitted: &super::oracle_emit::Prepared) -> Vec<(String, Utf8PathBuf)> {
    let mut files = [
        ("oracle-emitter", "oracle-emit.ts"),
        ("oracle-loader", "oracle-loader.ts"),
        ("oracle-assets", "oracle-assets.ts"),
        ("oracle-filesystem", "oracle-filesystem.ts"),
        ("oracle-toolchain-record", "oracle-toolchain.json"),
        ("oracle-package", "package.json"),
    ]
    .into_iter()
    .map(|(name, file)| (name.into(), emitted.assets.join(file)))
    .collect::<Vec<_>>();
    // Bind preparation assets and the bytes the relative --import executes.
    if let Some(session) = emitted.manifest.parent() {
        for file in [
            "oracle-emit.ts",
            "oracle-loader.ts",
            "oracle-assets.ts",
            "oracle-filesystem.ts",
            "oracle-toolchain.json",
            "package.json",
        ] {
            files.push((
                format!("oracle-execution:{file}"),
                session.join("assets").join(file),
            ));
        }
    }
    files
}

pub(crate) fn finish_oracle(
    pending: Option<Pending>,
    run: &Result<super::Run>,
    status: &Value,
    completion: &Value,
) {
    if let Some(pending) = pending {
        let mut result = outcome(run);
        result["provisional"] = true.into();
        result["snapshot_finalization"] = "pending".into();
        result["oracle_status"] = status.clone();
        result["oracle_completion"] = completion.clone();
        pending.finish(result);
    }
}

fn outcome(run: &Result<super::Run>) -> Value {
    match run {
        Ok(run) => {
            json!({"results":run.results,"output":run.output.stdout,"stderr":run.output.stderr,"thrown":run.thrown})
        }
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn oracle_package_semantics_change_the_actual_observer_key() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let assets = scratch.path.join("preparation-assets");
        let costs = scratch.path.join("costs");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::create_dir_all(&costs).unwrap();
        let emitted = super::super::oracle_emit::Prepared {
            manifest: scratch.path.join("session/manifest.json"),
            loader_state: scratch.path.join("loader-state.json"),
            identity: Value::Null,
            snapshot: Value::Null,
            args: Vec::new(),
            assets,
        };
        let files = oracle_assets(&emitted);
        for (_, path) in &files {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "{}").unwrap();
        }
        let package = emitted.assets.join("package.json");
        std::fs::write(&package, "{\"type\":\"module\"}\n").unwrap();
        let request = scratch.path.join("request.json");
        std::fs::write(
            &request,
            serde_json::to_vec(&json!({
                "kind":"bench-oracle-node", "mode":"prepare", "tools":[], "values":{},
                "files":files.into_iter().map(|(name,path)|json!({"name":name,"path":path})).collect::<Vec<_>>()
            })).unwrap(),
        ).unwrap();
        let key = || {
            let output = std::process::Command::new("node")
                .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../gate/artifact-shadow.ts"))
                .arg("--request")
                .arg(&request)
                .env("NTS_GATE_SHADOW_DIR", scratch.path.join("cache"))
                .env("NTS_GATE_CASE_COSTS_DIR", &costs)
                .env("NTS_GATE_STEP", "bench-agree")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let observed: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert!(observed["key"].is_string(), "{observed}");
            observed["key"].clone()
        };
        let before = key();
        std::fs::write(package, "{\"type\":\"commonjs\"}\n").unwrap();
        assert_ne!(before, key());
        let before = key();
        let execution = emitted.manifest.parent().unwrap().join("assets");
        std::fs::write(execution.join("oracle-loader.ts"), "changed loader byte").unwrap();
        assert_ne!(before, key());
        let before = key();
        std::fs::write(execution.join("package.json"), "{\"type\":\"commonjs\"}\n").unwrap();
        assert_ne!(before, key());
        let before = key();
        std::fs::write(
            emitted.assets.join("oracle-filesystem.ts"),
            "changed observation adapter",
        )
        .unwrap();
        assert_ne!(before, key());
        let before = key();
        std::fs::write(
            execution.join("oracle-filesystem.ts"),
            "changed execution adapter",
        )
        .unwrap();
        assert_ne!(before, key());
    }
}
