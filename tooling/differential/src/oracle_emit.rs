//! The JavaScript entry owns TypeScript options, program emit and identity.
//! This adapter retains the existing oracle supervisor and actual Node argv.
use anyhow::{Context as _, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
pub(super) struct Prepared {
    pub(super) manifest: Utf8PathBuf,
    #[serde(rename = "loaderState")]
    pub(super) loader_state: Utf8PathBuf,
    pub(super) identity: Value,
    pub(super) snapshot: Value,
    pub(super) args: Vec<String>,
    #[serde(skip)]
    pub(super) assets: Utf8PathBuf,
}

const IMPLEMENTATION_FILES: &[(&str, &str)] = &[
    ("oracle-batch.ts", include_str!("../oracle-batch.ts")),
    ("oracle-emit.ts", include_str!("../oracle-emit.ts")),
    (
        "oracle-execution.ts",
        include_str!("../oracle-execution.ts"),
    ),
    (
        "oracle-execution-policy.ts",
        include_str!("../oracle-execution-policy.ts"),
    ),
    ("oracle-loader.ts", include_str!("../oracle-loader.ts")),
    ("oracle-assets.ts", include_str!("../oracle-assets.ts")),
    (
        "oracle-filesystem.ts",
        include_str!("../oracle-filesystem.ts"),
    ),
    ("oracle-runtime.ts", include_str!("../oracle-runtime.ts")),
    ("oracle-results.ts", include_str!("../oracle-results.ts")),
    (
        "oracle-resolution.ts",
        include_str!("../oracle-resolution.ts"),
    ),
    (
        "oracle-toolchain.json",
        include_str!("../oracle-toolchain.json"),
    ),
    ("package.json", "{\"type\":\"module\"}\n"),
];

pub(super) fn verify_source(root: &Utf8Path) -> Result<()> {
    for &(name, bytes) in IMPLEMENTATION_FILES {
        if name == "package.json" {
            continue;
        }
        anyhow::ensure!(
            std::fs::read(root.join(name))? == bytes.as_bytes(),
            "oracle source-owned producer {name} identity changed"
        );
    }
    Ok(())
}

fn materialize(directory: &Utf8Path) -> Result<Utf8PathBuf> {
    std::fs::create_dir_all(directory)?;
    for &(name, bytes) in IMPLEMENTATION_FILES {
        std::fs::write(directory.join(name), bytes)?;
    }
    Ok(directory.join("oracle-emit.ts"))
}

// Each drained execution gets a fresh path. A child shares its parent's path,
// so a later ready event cannot erase an earlier instrument event.
pub(super) struct ExecutionState {
    pub(super) path: Utf8PathBuf,
    reader: Option<std::fs::File>,
    result: Option<std::result::Result<(), String>>,
}

impl ExecutionState {
    fn create(path: Utf8PathBuf) -> Result<Self> {
        let reader = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(Self {
            path,
            reader: Some(reader),
            result: None,
        })
    }
}

pub(super) fn execution_state(prepared: &Prepared) -> Result<ExecutionState> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let states = prepared
        .manifest
        .parent()
        .context("oracle session has no parent")?
        .join("states");
    std::fs::create_dir_all(&states)?;
    loop {
        let own = states.join(format!(
            "execution-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        match std::fs::create_dir(&own) {
            Ok(()) => return ExecutionState::create(own.join("events.jsonl")),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
}

pub(super) fn capture_execution_driver(
    prepared: &Prepared,
    state: &Utf8Path,
    driver: &Utf8Path,
) -> Result<()> {
    use std::io::Write as _;
    let driver = driver.canonicalize_utf8()?;
    let record = serde_json::json!({"version":1,
        "manifestSha256":prepared.snapshot["manifestSha256"],
        "driver":{"path":driver,"sha256":digest(&std::fs::read(&driver)?)}});
    let owner = state.parent().context("oracle execution has no owner")?;
    let pins = serde_json::json!({"version":1,
        "manifestSha256":prepared.snapshot["manifestSha256"],
        "indexSha256":prepared.snapshot["index"]["sha256"]});
    let mut pins_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(owner.join("snapshot-owner.json"))?;
    pins_file.write_all(serde_json::to_vec(&pins)?.as_slice())?;
    let file = owner.join("module-inputs.json");
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)?;
    output.write_all(serde_json::to_string(&record)?.as_bytes())?;
    Ok(())
}

pub(super) fn ensure_loaded(state: &mut ExecutionState) -> Result<()> {
    if state.result.is_none() {
        let reader = state
            .reader
            .take()
            .context("Node oracle execution event reader is closed")?;
        state.result = Some(read_loader_events(reader).map_err(|error| format!("{error:#}")));
    }
    state
        .result
        .as_ref()
        .context("Node oracle execution has no drained result")?
        .clone()
        .map_err(anyhow::Error::msg)
}

#[derive(Clone, Copy, PartialEq)]
enum ChildState {
    Reserved,
    Begun,
    Ready,
    LaunchFailed,
}

fn read_loader_events(mut reader: std::fs::File) -> Result<()> {
    use std::io::Read as _;
    let mut bytes = String::new();
    reader
        .read_to_string(&mut bytes)
        .context("Node oracle did not report loader completion")?;
    if !bytes.ends_with('\n') || bytes.trim().is_empty() {
        bail!("Node oracle loader status is empty or truncated");
    }
    let mut ready = false;
    let mut instrument = None;
    let mut children = HashMap::new();
    for line in bytes[..bytes.len() - 1].split('\n') {
        let event: Value =
            serde_json::from_str(line).context("invalid Node oracle loader event")?;
        let fields = event
            .as_object()
            .context("invalid Node oracle loader event")?;
        if event["version"].as_f64() != Some(1.0) {
            bail!("invalid Node oracle loader event: {event}");
        }
        match (
            event["status"].as_str(),
            fields.len(),
            event["reason"].as_str(),
        ) {
            (Some("ready"), 2, _) => ready = true,
            (Some("instrument"), 3, Some(reason)) => {
                instrument.get_or_insert(reason.to_owned());
            }
            (
                Some(
                    status
                    @ ("child-start" | "child-begin" | "child-ready" | "child-launch-failed"),
                ),
                3,
                _,
            ) => {
                let execution = event["execution"]
                    .as_str()
                    .context("invalid Node oracle child event")?;
                let suffix = execution
                    .strip_prefix("execution-")
                    .context("invalid Node oracle child event")?;
                if suffix.is_empty()
                    || !suffix
                        .bytes()
                        .all(|value| value.is_ascii_alphanumeric() || value == b'-')
                {
                    bail!("invalid Node oracle child event");
                }
                if status == "child-start" {
                    if children
                        .insert(execution.to_owned(), ChildState::Reserved)
                        .is_some()
                    {
                        bail!("duplicate Node oracle child reservation");
                    }
                } else {
                    let previous = children
                        .get_mut(execution)
                        .context("unknown Node oracle child completion")?;
                    *previous = match (status, *previous) {
                        ("child-begin", ChildState::Reserved) => ChildState::Begun,
                        ("child-ready", ChildState::Begun) => ChildState::Ready,
                        ("child-launch-failed", ChildState::Reserved) => ChildState::LaunchFailed,
                        _ => bail!("duplicate or out-of-order Node oracle child completion"),
                    };
                }
            }
            _ => bail!("invalid Node oracle loader event: {event}"),
        }
    }
    if let Some(reason) = instrument {
        bail!("Node oracle loader was not measured: {reason}");
    }
    if let Some((execution, _)) = children
        .iter()
        .find(|(_, status)| !matches!(status, ChildState::Ready | ChildState::LaunchFailed))
    {
        bail!("Node oracle child did not complete bootstrap: {execution}");
    }
    if !ready {
        bail!("Node oracle loader never reported ready");
    }
    Ok(())
}

pub(super) fn node_command() -> std::process::Command {
    let mut command = std::process::Command::new("prlimit");
    command.arg("--core=0").arg("node");
    command
}

#[derive(Deserialize)]
pub(super) struct ProgramReference {
    #[serde(default)]
    pub(super) rows: Vec<String>,
    #[serde(default)]
    pub(super) stdout: Vec<u8>,
    #[serde(default)]
    pub(super) stderr: Vec<u8>,
    pub(super) replay: Option<Prepared>,
    pub(super) budget: Option<Value>,
}

fn uri_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut text = String::with_capacity(bytes.len() * 3);
    for &byte in bytes {
        text.push('%');
        text.push(char::from(HEX[usize::from(byte >> 4)]));
        text.push(char::from(HEX[usize::from(byte & 15)]));
    }
    text
}

fn program_reader_arguments(root: &Value) -> Result<Vec<String>> {
    const BOOTSTRAP: &str = include_str!("../oracle-result-bootstrap.ts");
    let directory = Utf8Path::new(
        root["directory"]
            .as_str()
            .context("program oracle result has no directory")?,
    );
    let reader = directory.join("reader");
    let runtime = &root["runtime"];
    anyhow::ensure!(
        runtime["version"] == 1
            && runtime["directory"] == reader.as_str()
            && runtime["bootstrapSha256"] == digest(BOOTSTRAP.as_bytes()),
        "program oracle reader runtime identity changed"
    );
    anyhow::ensure!(
        reader.canonicalize_utf8()? == reader,
        "program oracle reader directory changed"
    );
    verify_implementation(&root["identity"], &reader)?;
    anyhow::ensure!(
        std::fs::read(reader.join("oracle-results.ts"))? == include_bytes!("../oracle-results.ts")
            && std::fs::read(reader.join("oracle-result-bootstrap.ts"))? == BOOTSTRAP.as_bytes(),
        "program oracle reader source identity changed"
    );
    let assets = runtime["assets"]
        .as_object()
        .context("program oracle reader has no assets")?;
    let names = [
        "oracle-results.mjs",
        "oracle-filesystem.mjs",
        "oracle-runtime.mjs",
    ];
    anyhow::ensure!(
        assets.len() == names.len(),
        "program oracle reader asset set changed"
    );
    let mut files = std::collections::BTreeMap::new();
    for name in names {
        let sha = assets
            .get(name)
            .and_then(Value::as_str)
            .context("program oracle reader asset is missing")?;
        anyhow::ensure!(
            sha.len() == 64
                && sha
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "program oracle reader asset identity changed"
        );
        files.insert(reader.join(name).into_string(), sha);
    }
    let bootstrap = format!(
        "data:text/javascript,{}#{}",
        uri_bytes(BOOTSTRAP.as_bytes()),
        uri_bytes(serde_json::to_string(&files)?.as_bytes())
    );
    Ok(vec![
        "--import".into(),
        bootstrap,
        reader.join("oracle-results.mjs").into_string(),
    ])
}

/// Read a completed answer without capturing a toolchain or starting its SDK.
pub(super) fn program_reference(
    _directory: &Utf8Path,
    project: &Utf8Path,
    entry: &Utf8Path,
    driver: &str,
) -> Result<Option<ProgramReference>> {
    let Some(raw) = std::env::var_os("NTS_PROGRAM_ORACLE") else {
        return Ok(None);
    };
    let handoff: Value = serde_json::from_str(&raw.to_string_lossy())?;
    let file = Utf8Path::new(
        handoff["file"]
            .as_str()
            .context("program oracle handoff has no file")?,
    );
    let bytes = std::fs::read(file)?;
    if !file.is_absolute() || handoff["sha256"] != digest(&bytes) {
        bail!("program oracle root identity changed");
    }
    let root: Value = serde_json::from_slice(&bytes)?;
    let arguments = program_reader_arguments(&root)?;
    if root["readerSha256"] != digest(include_bytes!("../oracle-results.ts")) {
        bail!("program oracle reader identity changed");
    }
    let request = serde_json::json!({"handoff":handoff,"project":project.canonicalize_utf8()?,
        "entry":entry.canonicalize_utf8()?,"driverSha256":digest(driver.as_bytes())});
    let mut command = node_command();
    command
        .args(arguments)
        .arg("--read-program-reference")
        .arg(serde_json::to_string(&request)?);
    let mut status = Value::Null;
    let output = super::case_costs::child("oracle.reference", || {
        let finished = super::oracle_run::run(
            super::without_colour(command),
            std::time::Duration::from_millis(super::oracle_coverage::IDLE_MILLIS),
        )?;
        status = finished.status;
        Ok::<_, anyhow::Error>(finished.output)
    })?;
    if !output.status.success() || !status["stop"].is_null() {
        bail!(
            "program oracle reference held: {}\n{}",
            status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let reference: ProgramReference = serde_json::from_slice(&output.stdout)?;
    Ok(Some(reference))
}

const SEAL_FIELDS: [&str; 8] = [
    "dev", "ino", "uid", "mode", "nlink", "size", "mtimeNs", "ctimeNs",
];

fn sealed_dependency_ready(
    capability: &Value,
    raw: &str,
    context: Option<&str>,
) -> Result<Option<Utf8PathBuf>> {
    let Some(seal) = capability.get("seal") else {
        return Ok(None);
    };
    let Some(context) = context else {
        return Ok(None);
    };
    let record = seal["record"].as_str().unwrap_or("invalid record");
    let changed = || anyhow::anyhow!("oracle dependency seal changed: {record}");
    let context: Value = serde_json::from_str(context).map_err(|_| changed())?;
    if context["report"]["version"] != 1
        || context["owned"]["NTS_ORACLE_DEPENDENCIES"].as_str() != Some(raw)
        || context["report"]["host"]["NTS_ORACLE_DEPENDENCIES"].as_str() != Some(raw)
    {
        return Err(changed());
    }
    let directory = Utf8Path::new(capability["directory"].as_str().ok_or_else(changed)?);
    let node = seal["nodeVersion"].as_str().ok_or_else(changed)?;
    let major = node.split('.').next();
    let expected = dependency_node_directory(directory, node)
        .map_err(|_| changed())?
        .join("ready.json");
    let identity = seal["identity"].as_object().ok_or_else(changed)?;
    let hash = |name: &str| {
        seal[name].as_str().is_some_and(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    };
    if capability["version"] != 1
        || seal["version"] != 1
        || !directory.is_absolute()
        || !matches!(major, Some("24" | "26"))
        || record != expected.as_str()
        || !hash("readySha256")
        || !hash("semanticSha256")
        || identity.len() != SEAL_FIELDS.len()
        || SEAL_FIELDS.iter().any(|key| {
            !identity
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        })
    {
        return Err(changed());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let meta = std::fs::symlink_metadata(&expected).map_err(|_| changed())?;
        if !meta.is_file() || meta.nlink() != 1 || meta.mode() & 0o222 != 0 {
            return Err(changed());
        }
        let actual = [
            meta.dev().to_string(),
            meta.ino().to_string(),
            meta.uid().to_string(),
            meta.mode().to_string(),
            meta.nlink().to_string(),
            meta.size().to_string(),
            (i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec())).to_string(),
            (i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec())).to_string(),
        ];
        if SEAL_FIELDS
            .iter()
            .zip(actual)
            .any(|(key, value)| identity[*key].as_str() != Some(value.as_str()))
        {
            return Err(changed());
        }
        Ok(Some(expected))
    }
    #[cfg(not(unix))]
    {
        Err(changed())
    }
}

fn write_acquisition_event(file: &mut impl std::io::Write, event: &Value) -> Result<()> {
    let mut line = serde_json::to_vec(event)?;
    line.push(b'\n');
    let written = file.write(&line)?;
    if written != line.len() {
        bail!(
            "short oracle dependency acquisition append: {written}/{} bytes",
            line.len()
        );
    }
    Ok(())
}

fn record_sealed_acquisition(capability: &Value, ready: &Utf8Path, wall_ms: f64) {
    let root = if capability["admission"]["kind"] == "gate" {
        capability["admission"]["temporary"]["parent"].as_str()
    } else {
        capability["directory"].as_str()
    };
    let Some(root) = root else { return };
    let event = serde_json::json!({"version":1,"step":capability["ownerStep"],"nodeVersion":capability["seal"]["nodeVersion"],"directory":ready.parent(),"mode":"hit","sealed":true,"helperProcess":false,"wallMs":wall_ms,"pnpmSelectionCommands":0});
    // Observation only, append without fsync; missing telemetry cannot authorize a verdict.
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(Utf8Path::new(root).join("oracle-dependency-calls.jsonl"))
    {
        let _ = write_acquisition_event(&mut file, &event);
    }
}

// Capturing installed inputs is run preparation, not the application. The
// shared helper admits and owns its separately bounded resident build; only
// completed ready inputs may reach the unchanged two-GiB application command.
fn prepare_dependencies() -> Result<()> {
    let Ok(raw) = std::env::var("NTS_ORACLE_DEPENDENCIES") else {
        return Ok(());
    };
    let capability: Value =
        serde_json::from_str(&raw).context("invalid oracle dependency capability")?;
    let source = Utf8Path::new(
        capability["source"]
            .as_str()
            .context("missing oracle dependency source")?,
    );
    let directory = Utf8Path::new(
        capability["directory"]
            .as_str()
            .context("missing oracle dependency directory")?,
    );
    let helper = source.join("tooling/differential/oracle-dependencies.ts");
    let expected = digest(include_bytes!("../oracle-dependencies.ts"));
    if capability["version"] != 1
        || !source.is_absolute()
        || !directory.is_absolute()
        || capability["helperSha256"].as_str() != Some(expected.as_str())
    {
        bail!("oracle dependency preparation helper identity mismatch");
    }
    let began = std::time::Instant::now();
    if let Some(ready) = sealed_dependency_ready(
        &capability,
        &raw,
        std::env::var("NTS_GATE_ENV_CONTEXT").ok().as_deref(),
    )? {
        record_sealed_acquisition(&capability, &ready, began.elapsed().as_secs_f64() * 1000.0);
        return Ok(());
    }
    if digest(&std::fs::read(&helper)?) != expected {
        bail!("oracle dependency preparation helper identity mismatch")
    }
    let mut command = std::process::Command::new("prlimit");
    command.current_dir(source).args([
        "--core=0",
        "--cpu=300:301",
        "node",
        helper.as_str(),
        "--capture",
        &raw,
    ]);
    let mut incomplete = None;
    let output = super::case_costs::child("oracle.dependencies", || {
        let finished = super::call_activity::command(
            super::without_colour(command),
            super::call_activity::Limits {
                cpu_seconds: 300.0,
                // Admission may legitimately wait. The shared capture helper
                // applies the 120-second idle guard to its admitted build.
                idle: std::time::Duration::MAX,
            },
        )?;
        incomplete = finished.incomplete;
        Ok::<_, anyhow::Error>(finished.output)
    })?;
    if !output.status.success() || incomplete.is_some() {
        bail!(
            "oracle dependency preparation held: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let returned = String::from_utf8_lossy(&output.stdout);
    let ready = Utf8Path::new(returned.trim());
    let node_version = ready
        .parent()
        .and_then(Utf8Path::file_name)
        .and_then(|name| name.strip_prefix("node-"))
        .context("oracle dependency preparation omitted its Node version")?;
    let image_directory = dependency_node_directory(directory, node_version)?;
    if ready != image_directory.join("ready.json") {
        bail!("oracle dependency preparation returned an unowned ready path");
    }
    let semantic = std::fs::read(image_directory.join("semantic.json"))?;
    verify_dependencies(
        Some(&serde_json::json!({"semanticSha256":digest(&semantic),"nodeVersion":node_version})),
        Some(&raw),
    )?;
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    Ok(())
}

pub(super) fn prepare(
    directory: &Utf8Path,
    source: &Utf8Path,
    tsconfig: &Utf8Path,
) -> Result<Prepared> {
    prepare_dependencies()?;
    let owned = directory.canonicalize_utf8()?.join("oracle-emit");
    let assets = owned.join("assets");
    materialize(&assets)?;
    let value = super::case_costs::measure("oracle.emit", || {
        super::oracle_run::prepare(
            &serde_json::json!({"entry":source,"directory":owned,"project":tsconfig.canonicalize_utf8()?}),
        )
    })?;
    let mut prepared: Prepared =
        serde_json::from_value(value).context("reading shared TypeScript emit preparation")?;
    if !prepared.manifest.starts_with(&owned)
        || !prepared.manifest.is_file()
        || prepared.loader_state.parent() != prepared.manifest.parent()
    {
        bail!("shared TypeScript emitter returned no owned manifest");
    }
    let bytes = std::fs::read(&prepared.manifest)?;
    let stored: Value = serde_json::from_slice(&bytes)?;
    if prepared.snapshot != bind_snapshot(&prepared.manifest, &bytes, &stored["runtimeIndex"])? {
        bail!("oracle snapshot preparation identity mismatch");
    }
    // Fresh preparation uses the verified source-owned producer. Unlike a
    // published handoff, its source assets belong to this native owner.
    verify_implementation(&prepared.identity, &assets)?;
    if stored["identity"] != prepared.identity
        || stored["entry"] != source.as_str()
        || stored["project"] != tsconfig.canonicalize_utf8()?.as_str()
    {
        bail!("oracle snapshot implementation identity mismatch");
    }
    prepared.assets = assets;
    Ok(prepared)
}

/// Pin the same small runtime index that JavaScript published. Original proof
/// bytes stay in the audit manifest and are replayed only at the parent seams.
fn bind_snapshot(manifest: &Utf8Path, bytes: &[u8], index: &Value) -> Result<Value> {
    let session = manifest
        .parent()
        .context("oracle snapshot has no session")?;
    let hash = index["sha256"]
        .as_str()
        .context("oracle snapshot index hash is missing")?;
    let route = index["path"]
        .as_str()
        .context("oracle snapshot index path is missing")?;
    if index.as_object().map(serde_json::Map::len) != Some(2)
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || route != format!("runtime-index/{hash}.json")
    {
        bail!("oracle snapshot index reference is invalid");
    }
    let path = session_route(session, Utf8Path::new(route))?;
    if !std::fs::symlink_metadata(session.join("runtime-index"))?.is_dir()
        || !std::fs::symlink_metadata(&path)?.is_file()
        || digest(&std::fs::read(&path)?) != hash
    {
        bail!("oracle snapshot index changed");
    }
    let stored: Value = serde_json::from_slice(bytes)?;
    let assets = stored["runtimeAssets"]
        .as_object()
        .context("oracle generated bootstrap assets are missing")?;
    if assets.len() != 3 || !std::fs::symlink_metadata(session.join("assets"))?.is_dir() {
        bail!("oracle generated bootstrap asset set changed");
    }
    for name in ["loader", "runtime", "assets"] {
        let route = format!("assets/oracle-{name}.mjs");
        let path = session_route(session, Utf8Path::new(&route))?;
        let expected = assets
            .get(&route)
            .and_then(Value::as_str)
            .context("oracle generated bootstrap hash is missing")?;
        if !std::fs::symlink_metadata(&path)?.is_file()
            || digest(&std::fs::read(&path)?) != expected
        {
            bail!("oracle generated bootstrap asset changed: {route}");
        }
    }
    Ok(
        serde_json::json!({"version":1,"index":index,"manifestSha256":digest(bytes),"assets":assets}),
    )
}

/// The supervising parent calls this once after all execution and output-window
/// replays, on both success and error, before any final report or cleanup.
pub(super) fn finish_snapshot(prepared: &Prepared) -> Result<()> {
    let mut command = node_command();
    command
        .arg(prepared.assets.join("oracle-emit.ts"))
        .arg("--finish-snapshot")
        .arg(serde_json::to_string(&serde_json::json!({
            "manifest":prepared.manifest,"snapshot":prepared.snapshot}))?);
    let mut status = Value::Null;
    let output = super::case_costs::child("oracle.finalize", || {
        let finished = super::oracle_run::run(
            super::without_colour(command),
            std::time::Duration::from_millis(super::oracle_coverage::IDLE_MILLIS),
        )?;
        status = finished.status;
        Ok::<_, anyhow::Error>(finished.output)
    })?;
    let health: Value = serde_json::from_slice(&output.stdout)
        .context("oracle snapshot finalization result is missing or unreadable")?;
    if !output.status.success() || !status["stop"].is_null() || health["ready"] != true {
        bail!(
            "oracle snapshot finalization held: {}\n{}\n{}",
            health,
            status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

#[derive(Deserialize)]
struct Manifest {
    version: u32,
    status: String,
    identity: Value,
    entry: Utf8PathBuf,
    project: Utf8PathBuf,
    roots: Value,
    inputs: std::collections::BTreeMap<Utf8PathBuf, String>,
    outputs: std::collections::BTreeMap<Utf8PathBuf, String>,
    groups: Vec<PreparedGroup>,
    observations: Vec<HostObservation>,
    dependencies: Option<Value>,
    #[serde(rename = "runtimeIndex")]
    runtime_index: Value,
}

fn dependency_node_directory(directory: &Utf8Path, version: &str) -> Result<Utf8PathBuf> {
    let parts: Vec<_> = version.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        bail!("invalid oracle dependency Node version");
    }
    Ok(directory.join(format!("node-{version}")))
}

fn verify_dependencies(dependencies: Option<&Value>, capability: Option<&str>) -> Result<()> {
    let Some(dependencies) = dependencies else {
        return Ok(());
    };
    let raw =
        capability.context("oracle dependency capability NTS_ORACLE_DEPENDENCIES is missing")?;
    let capability: Value = serde_json::from_str(raw)?;
    if let Some(ready) = sealed_dependency_ready(
        &capability,
        raw,
        std::env::var("NTS_GATE_ENV_CONTEXT").ok().as_deref(),
    )? {
        if dependencies["semanticSha256"] != capability["seal"]["semanticSha256"]
            || dependencies["nodeVersion"] != capability["seal"]["nodeVersion"]
        {
            bail!("oracle dependency seal changed: {ready}");
        }
        return Ok(());
    }
    if capability["version"] != 1 {
        bail!("invalid oracle dependency capability version");
    }
    let directory = Utf8Path::new(
        capability["directory"]
            .as_str()
            .context("invalid oracle dependency capability")?,
    );
    if !directory.is_absolute() {
        bail!("invalid oracle dependency capability directory");
    }
    let node_version = dependencies["nodeVersion"]
        .as_str()
        .context("oracle dependency Node version is missing")?;
    let directory = dependency_node_directory(directory, node_version)?;
    let bytes = std::fs::read(directory.join("semantic.json"))
        .context("oracle dependency capture is not ready")?;
    if dependencies["semanticSha256"].as_str() != Some(digest(&bytes).as_str()) {
        bail!("oracle captured dependency identity changed");
    }
    let semantic: Value = serde_json::from_slice(&bytes)?;
    let ready: Value = serde_json::from_slice(&std::fs::read(directory.join("ready.json"))?)?;
    if ready["version"] != 1
        || ready["inputSet"]["version"] != 1
        || ready["inputSet"]["identity"]["node"] != node_version
        || ready["inputSet"] != semantic["inputSet"]
        || ready["lockfileSha256"] != capability["lockfileSha256"]
        || ready["sourceRevision"] != capability["sourceRevision"]
        || semantic["lockfileSha256"] != ready["lockfileSha256"]
    {
        bail!("oracle dependency ready identity mismatch");
    }
    Ok(())
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ObservationKind {
    File,
    FileExists,
    DirectoryExists,
    Entries,
    Realpath,
    Readlink,
    RuntimeEntries,
    RuntimeKind,
}
impl ObservationKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::FileExists => "fileExists",
            Self::DirectoryExists => "directoryExists",
            Self::Entries => "entries",
            Self::Realpath => "realpath",
            Self::Readlink => "readlink",
            Self::RuntimeEntries => "runtimeEntries",
            Self::RuntimeKind => "runtimeKind",
        }
    }
}
impl std::fmt::Display for ObservationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostObservation {
    kind: ObservationKind,
    path: Utf8PathBuf,
    value: Value,
}

fn missing(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

fn file_metadata(path: &Utf8Path) -> Result<Option<std::fs::Metadata>> {
    match std::fs::metadata(path) {
        Ok(info) => Ok(Some(info)),
        Err(error) if missing(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn directory_entries(path: &Utf8Path) -> Result<Value> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => Some(entries),
        Err(error) if missing(&error) => None,
        Err(error) => return Err(error.into()),
    };
    let (mut files, mut directories) = (Vec::new(), Vec::new());
    for entry in entries.into_iter().flatten() {
        let entry = entry?;
        let name = entry.file_name().into_string().map_err(|_| {
            anyhow::anyhow!("oracle filesystem directory has a non-UTF8 name: {path}")
        })?;
        if let Some(info) = file_metadata(&path.join(&name))? {
            if info.is_file() {
                files.push(name);
            } else if info.is_dir() {
                directories.push(name);
            }
        }
    }
    // UTF-8 ordering is shared with the builtin-only JavaScript adapter.
    files.sort();
    directories.sort();
    Ok(serde_json::json!({"files":files,"directories":directories}))
}

fn host_answer(observation: &HostObservation) -> Result<Value> {
    let path = &observation.path;
    if !path.is_absolute() {
        bail!("invalid oracle filesystem observation path: {path}");
    }
    match observation.kind.as_str() {
        "runtimeEntries" => runtime_entries(observation),
        "runtimeKind" => runtime_kind(observation),
        "file" => {
            if !observation.value.is_null()
                && !observation.value.as_str().is_some_and(|value| {
                    value.len() == 64
                        && value
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
            {
                bail!("invalid oracle file observation: {path}");
            }
            match std::fs::read(path) {
                Ok(bytes) => Ok(digest(&bytes).into()),
                Err(error) if missing(&error) => Ok(Value::Null),
                Err(error) => Err(error.into()),
            }
        }
        "fileExists" | "directoryExists" => {
            if !observation.value.is_boolean() {
                bail!("invalid oracle existence observation: {path}");
            }
            Ok(file_metadata(path)?
                .is_some_and(|info| {
                    if observation.kind.as_str() == "fileExists" {
                        info.is_file()
                    } else {
                        info.is_dir()
                    }
                })
                .into())
        }
        "entries" => {
            let fields = observation
                .value
                .as_object()
                .context("invalid oracle directory observation")?;
            if fields.len() != 2
                || ["files", "directories"].iter().any(|key| {
                    !fields
                        .get(*key)
                        .and_then(Value::as_array)
                        .is_some_and(|values| {
                            values.iter().all(|value| {
                                value.as_str().is_some_and(|name| {
                                    name != "."
                                        && name != ".."
                                        && !name.contains(std::path::MAIN_SEPARATOR)
                                })
                            })
                        })
                })
            {
                bail!("invalid oracle directory observation: {path}");
            }
            directory_entries(path)
        }
        "realpath" => {
            if !observation
                .value
                .as_str()
                .is_some_and(|value| Utf8Path::new(value).is_absolute())
            {
                bail!("invalid oracle realpath observation: {path}");
            }
            match path.canonicalize_utf8() {
                Ok(actual) => Ok(actual.as_str().into()),
                Err(error) if missing(&error) => Ok(path.as_str().into()),
                Err(error) => Err(error.into()),
            }
        }
        "readlink" => literal_link(observation),
        _ => bail!(
            "invalid oracle filesystem observation kind: {}",
            observation.kind
        ),
    }
}

fn literal_link(observation: &HostObservation) -> Result<Value> {
    let path = &observation.path;
    if !observation.value.is_null() && !observation.value.is_string() {
        bail!("invalid oracle readlink observation: {path}");
    }
    match std::fs::symlink_metadata(path) {
        Ok(info) if !info.file_type().is_symlink() => return Ok(Value::Null),
        Ok(_) => {}
        Err(error) if missing(&error) => return Ok(Value::Null),
        Err(error) => return Err(error.into()),
    }
    match std::fs::read_link(path) {
        Ok(target) => Ok(target
            .to_str()
            .context("oracle filesystem link has a non-UTF8 target")?
            .into()),
        Err(error) if missing(&error) || error.kind() == std::io::ErrorKind::InvalidInput => {
            Ok(Value::Null)
        }
        Err(error) => Err(error.into()),
    }
}

fn runtime_kind(observation: &HostObservation) -> Result<Value> {
    let path = &observation.path;
    if !observation.value.is_null()
        && !observation
            .value
            .as_str()
            .is_some_and(|kind| ["file", "directory", "symlink", "other"].contains(&kind))
    {
        bail!("invalid oracle runtime kind observation: {path}");
    }
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if missing(&error) => return Ok(Value::Null),
        Err(error) => return Err(error.into()),
    };
    Ok(Value::String(
        if metadata.is_symlink() {
            "symlink"
        } else if metadata.is_file() {
            "file"
        } else if metadata.is_dir() {
            "directory"
        } else {
            "other"
        }
        .to_owned(),
    ))
}

fn runtime_entries(observation: &HostObservation) -> Result<Value> {
    let path = &observation.path;
    if !observation.value.as_array().is_some_and(|names| {
        names.iter().all(|name| {
            name.as_str().is_some_and(|name| {
                name != "." && name != ".." && !name.contains(std::path::MAIN_SEPARATOR)
            })
        })
    }) {
        bail!("invalid oracle runtime directory observation: {path}");
    }
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => Some(entries),
        Err(error) if missing(&error) => None,
        Err(error) => return Err(error.into()),
    };
    let mut names = Vec::new();
    for entry in entries.into_iter().flatten() {
        names.push(entry?.file_name().into_string().map_err(|_| {
            anyhow::anyhow!("oracle runtime directory has a non-UTF8 name: {path}")
        })?);
    }
    names.sort();
    Ok(serde_json::json!(names))
}

#[cfg(test)]
thread_local! {static INPUT_JOIN_VISITS:std::cell::Cell<usize>=const {std::cell::Cell::new(0)};}

fn validate_observations(observations: &[HostObservation]) -> Result<HashMap<&Utf8Path, &Value>> {
    let started = std::time::Instant::now();
    let mut files = HashMap::new();
    for observation in observations {
        #[cfg(test)]
        INPUT_JOIN_VISITS.with(|visits| visits.set(visits.get() + 1));
        let actual = host_answer(observation).with_context(|| {
            format!(
                "oracle filesystem {} could not be checked: {}",
                observation.kind, observation.path
            )
        })?;
        if observation.value != actual {
            bail!(
                "oracle filesystem {} changed: {}",
                observation.kind,
                observation.path
            );
        }
        if matches!(observation.kind, ObservationKind::File)
            && let Some(previous) = files.insert(observation.path.as_path(), &observation.value)
            && previous != &observation.value
        {
            bail!(
                "conflicting oracle filesystem file observations: {}",
                observation.path
            );
        }
    }
    super::case_costs::event(
        serde_json::json!({"event":"oracle.validation","observations":observations.len(),"wall_s":started.elapsed().as_secs_f64()}),
    );
    Ok(files)
}

#[derive(Deserialize)]
struct PreparedGroup {
    output: Utf8PathBuf,
    project: Utf8PathBuf,
    #[serde(rename = "compilerStatus")]
    compiler_status: u8,
}

#[derive(Deserialize)]
struct Execution {
    #[serde(rename = "manifestVersion")]
    version: u32,
    options: String,
    args: Vec<String>,
}

/// A batch owner hands over a completed file, never an oracle implementation.
/// Verify it natively so consuming a batch pays no second emitter startup.
pub(super) fn read_prepared(
    manifest: &Utf8Path,
    source: &Utf8Path,
    tsconfig: &Utf8Path,
) -> Result<Prepared> {
    let manifest = manifest
        .canonicalize_utf8()
        .context("prepared oracle manifest is missing")?;
    let session = manifest
        .parent()
        .context("prepared oracle manifest has no session")?;
    let bytes = std::fs::read(&manifest)?;
    let stored: Manifest = serde_json::from_slice(&bytes)
        .context("prepared oracle manifest is incomplete or unreadable")?;
    let assets = session.join("assets");
    let execution = verify_implementation(&stored.identity, &assets)?;
    if stored.version != execution.version || stored.status != "complete" {
        bail!("prepared oracle is incomplete");
    }
    let observed_files = validate_observations(&stored.observations)?;
    verify_dependencies(
        stored.dependencies.as_ref(),
        std::env::var("NTS_ORACLE_DEPENDENCIES").ok().as_deref(),
    )?;
    let source = source.canonicalize_utf8()?;
    let tsconfig = tsconfig.canonicalize_utf8()?;
    if stored.entry != source || stored.project != tsconfig || !stored.roots.is_null() {
        bail!("prepared oracle current entry/project/roots mismatch");
    }
    if !stored.inputs.contains_key(&source) || !stored.inputs.contains_key(&tsconfig) {
        bail!("prepared oracle omits current source or project input");
    }
    for (file, expected) in &stored.inputs {
        #[cfg(test)]
        INPUT_JOIN_VISITS.with(|visits| visits.set(visits.get() + 1));
        if observed_files
            .get(file.as_path())
            .and_then(|value| value.as_str())
            != Some(expected.as_str())
        {
            bail!("oracle input has no matching filesystem observation: {file}");
        }
    }
    let typed = matches!(source.extension(), Some("ts" | "mts" | "cts" | "tsx"));
    if typed && (stored.outputs.is_empty() || stored.groups.is_empty()) {
        bail!("prepared TypeScript oracle has no completed project");
    }
    if !stored
        .outputs
        .contains_key(Utf8Path::new("source-index.json"))
    {
        bail!("prepared oracle emitted source index is not bound");
    }
    for (file, expected) in &stored.outputs {
        let file = session_route(session, file)?;
        if std::fs::symlink_metadata(&file)?.file_type().is_symlink() {
            bail!("prepared oracle output is a symlink: {file}");
        }
        if *expected != digest(&std::fs::read(&file)?) {
            bail!("prepared oracle output changed: {file}");
        }
    }
    for group in &stored.groups {
        if group.compiler_status != 0 {
            bail!("prepared oracle compiler did not accept the program");
        }
        session_route(session, &group.output)?;
        if !stored.inputs.contains_key(&group.project) {
            bail!("prepared oracle original project is not bound");
        }
    }
    let snapshot = bind_snapshot(&manifest, &bytes, &stored.runtime_index)?;
    Ok(Prepared {
        manifest: manifest.clone(),
        loader_state: session.join("loader-state.json"),
        identity: stored.identity,
        snapshot,
        args: execution.args,
        assets,
    })
}

/// Implementation identity is independent of the current request's contents.
fn verify_implementation(identity: &Value, assets: &Utf8Path) -> Result<Execution> {
    let record: Value = serde_json::from_str(include_str!("../oracle-toolchain.json"))?;
    let execution: Execution = serde_json::from_value(record["execution"].clone())?;
    let expected = &record["platforms"][platform_key()];
    if identity["version"] != 1 || expected.is_null() || identity["options"] != execution.options {
        bail!("prepared oracle implementation identity mismatch");
    }
    if identity["executionSha256"] != super::oracle_run::execution_identity()? {
        bail!("prepared oracle execution policy identity mismatch");
    }
    for file in [
        "oracle-execution.ts",
        "oracle-execution-policy.ts",
        "oracle-batch.ts",
    ] {
        let expected = if file == "oracle-execution.ts" {
            include_bytes!("../oracle-execution.ts").as_slice()
        } else if file == "oracle-execution-policy.ts" {
            include_bytes!("../oracle-execution-policy.ts").as_slice()
        } else {
            include_bytes!("../oracle-batch.ts").as_slice()
        };
        if std::fs::read(assets.join(file))? != expected {
            bail!("prepared oracle embedded {file} identity mismatch");
        }
    }
    for key in [
        "version",
        "rootPackageSha256",
        "packageSha256",
        "nativeSha256",
        "nativePackageSha256",
    ] {
        if identity["typescript"][key] != expected[key] {
            bail!("prepared oracle TypeScript {key} identity mismatch");
        }
    }
    for (file, key, bytes) in [
        (
            "oracle-emit.ts",
            "emitterSha256",
            include_str!("../oracle-emit.ts"),
        ),
        (
            "oracle-loader.ts",
            "loaderSha256",
            include_str!("../oracle-loader.ts"),
        ),
        (
            "oracle-assets.ts",
            "assetsSha256",
            include_str!("../oracle-assets.ts"),
        ),
        (
            "oracle-filesystem.ts",
            "filesystemSha256",
            include_str!("../oracle-filesystem.ts"),
        ),
        (
            "oracle-runtime.ts",
            "runtimeSha256",
            include_str!("../oracle-runtime.ts"),
        ),
        (
            "oracle-resolution.ts",
            "resolutionSha256",
            include_str!("../oracle-resolution.ts"),
        ),
        (
            "oracle-toolchain.json",
            "toolchainRecordSha256",
            include_str!("../oracle-toolchain.json"),
        ),
    ] {
        if identity[key] != digest(bytes.as_bytes())
            || std::fs::read(assets.join(file))? != bytes.as_bytes()
        {
            bail!("prepared oracle embedded {file} identity mismatch");
        }
    }
    if std::fs::read(assets.join("package.json"))? != b"{\"type\":\"module\"}\n" {
        bail!("prepared oracle module goal identity mismatch");
    }
    Ok(execution)
}

fn platform_key() -> String {
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        "solaris" => "sunos",
        other => other,
    };
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "powerpc64" => "ppc64",
        other => other,
    };
    format!("{platform}-{architecture}")
}

fn session_route(session: &Utf8Path, route: &Utf8Path) -> Result<Utf8PathBuf> {
    if route.as_str().is_empty()
        || route.components().any(|part| {
            !matches!(
                part,
                camino::Utf8Component::Normal(_) | camino::Utf8Component::CurDir
            )
        })
    {
        bail!("prepared oracle route escapes its session: {route}");
    }
    Ok(session.join(route))
}

pub(super) fn digest(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut result = String::with_capacity(64);
    for byte in hmac_sha256::Hash::hash(bytes) {
        let _ = write!(result, "{byte:02x}");
    }
    result
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn an_acquisition_event_is_one_complete_append() {
        use std::io::Write as _;
        #[derive(Default)]
        struct Appends(Vec<Vec<u8>>);
        impl std::io::Write for Appends {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.push(bytes.to_vec());
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut control = Appends::default();
        control.write_all(b"{\"control\":true}\n").unwrap();
        assert_eq!(control.0, [b"{\"control\":true}\n".to_vec()]);

        let event = serde_json::json!({"version":1,"mode":"hit","sealed":true,
            "directory":"/owned/run/日本語/line\nvalue","wallMs":0.125});
        let mut appends = Appends::default();
        super::write_acquisition_event(&mut appends, &event).unwrap();
        assert_eq!(
            appends.0.len(),
            1,
            "an acquisition must append one complete JSONL buffer"
        );
        let line = &appends.0[0];
        assert_eq!(line.last(), Some(&b'\n'));
        assert!(!line[..line.len() - 1].contains(&b'\n'));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(line).unwrap(),
            event
        );
    }

    #[test]
    fn a_short_acquisition_event_write_is_an_error_without_retry() {
        struct ShortWrite(usize);
        impl std::io::Write for ShortWrite {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0 += 1;
                Ok(bytes.len().saturating_sub(1))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut writer = ShortWrite(0);
        let event = serde_json::json!({"mode":"hit"});
        assert!(super::write_acquisition_event(&mut writer, &event).is_err());
        assert_eq!(writer.0, 1, "a short append must not retry a suffix");
    }

    #[test]
    #[cfg(unix)]
    fn run_seal_uses_exact_stat_strings_and_canonical_parent_authority() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        let scratch = super::super::Scratch::for_check().unwrap();
        let directory = scratch.path.join("node-26.13.0");
        std::fs::create_dir(&directory).unwrap();
        let ready = directory.join("ready.json");
        std::fs::write(&ready, "pinned bytes").unwrap();
        std::fs::set_permissions(&ready, std::fs::Permissions::from_mode(0o444)).unwrap();
        let meta = std::fs::symlink_metadata(&ready).unwrap();
        let values = [
            meta.dev().to_string(),
            meta.ino().to_string(),
            meta.uid().to_string(),
            meta.mode().to_string(),
            meta.nlink().to_string(),
            meta.size().to_string(),
            (i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec())).to_string(),
            (i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec())).to_string(),
        ];
        let identity: serde_json::Map<String, Value> = SEAL_FIELDS
            .iter()
            .zip(values)
            .map(|(key, value)| ((*key).into(), value.into()))
            .collect();
        let cap = serde_json::json!({"version":1,"directory":scratch.path,"seal":{"version":1,"nodeVersion":"26.13.0","record":ready,"readySha256":"a".repeat(64),"semanticSha256":"b".repeat(64),"identity":identity}});
        let context = |raw: &str| {
            serde_json::json!({"report":{"version":1,"host":{"NTS_ORACLE_DEPENDENCIES":raw}},"owned":{"NTS_ORACLE_DEPENDENCIES":raw}}).to_string()
        };
        let raw = cap.to_string();
        assert_eq!(
            sealed_dependency_ready(&cap, &raw, Some(&context(&raw))).unwrap(),
            Some(ready.clone())
        );
        assert_eq!(
            sealed_dependency_ready(&cap, &raw, None).unwrap(),
            None,
            "outside-run callers receive no fast-path grant"
        );
        assert!(
            sealed_dependency_ready(&cap, &raw, Some("{}"))
                .unwrap_err()
                .to_string()
                .contains("oracle dependency seal changed")
        );
        for key in SEAL_FIELDS {
            for value in [
                Value::Null,
                serde_json::json!(1),
                serde_json::json!(true),
                serde_json::json!("-1"),
                serde_json::json!("not-an-integer"),
            ] {
                let mut changed = cap.clone();
                changed["seal"]["identity"][key] = value;
                let raw = changed.to_string();
                assert!(
                    sealed_dependency_ready(&changed, &raw, Some(&context(&raw))).is_err(),
                    "{key}"
                );
            }
        }
        let replacement = directory.join("replacement");
        std::fs::write(&replacement, "pinned bytes").unwrap();
        std::fs::set_permissions(&replacement, std::fs::Permissions::from_mode(0o444)).unwrap();
        std::fs::rename(&replacement, &ready).unwrap();
        assert!(
            sealed_dependency_ready(&cap, &raw, Some(&context(&raw)))
                .unwrap_err()
                .to_string()
                .contains("oracle dependency seal changed")
        );
    }

    #[test]
    fn dependency_handoff_holds_missing_unknown_and_changed_authority() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let directory = scratch.path.join("node-26.13.0");
        std::fs::create_dir(&directory).unwrap();
        let semantic = br#"{"version":1,"inputSet":{"version":1,"identity":{"node":"26.13.0"}},"lockfileSha256":"lock"}"#;
        std::fs::write(directory.join("semantic.json"), semantic).unwrap();
        std::fs::write(
            directory.join("ready.json"),
            br#"{"version":1,"inputSet":{"version":1,"identity":{"node":"26.13.0"}},"lockfileSha256":"lock","sourceRevision":"source"}"#,
        )
        .unwrap();
        let dependency =
            serde_json::json!({"semanticSha256":digest(semantic),"nodeVersion":"26.13.0"});
        let capability = serde_json::json!({"version":1,"directory":scratch.path,"lockfileSha256":"lock","sourceRevision":"source"});
        verify_dependencies(Some(&dependency), Some(&capability.to_string())).unwrap();
        assert!(verify_dependencies(Some(&dependency), None).is_err());
        let mut unknown = capability.clone();
        unknown["version"] = 2.into();
        assert!(verify_dependencies(Some(&dependency), Some(&unknown.to_string())).is_err());
        let mut changed = capability.clone();
        changed["lockfileSha256"] = "changed".into();
        assert!(verify_dependencies(Some(&dependency), Some(&changed.to_string())).is_err());
        for version in ["", "../26.13.0", "26.13.0/other", "27.0.0"] {
            let mut wrong_version = dependency.clone();
            wrong_version["nodeVersion"] = version.into();
            assert!(
                verify_dependencies(Some(&wrong_version), Some(&capability.to_string())).is_err()
            );
        }
        std::fs::write(
            directory.join("ready.json"),
            br#"{"version":1,"inputSet":{"version":1,"identity":{"node":"26.13.0"},"paths":["changed"]},"lockfileSha256":"lock","sourceRevision":"source"}"#,
        )
        .unwrap();
        assert!(verify_dependencies(Some(&dependency), Some(&capability.to_string())).is_err());
        std::fs::write(directory.join("semantic.json"), "changed").unwrap();
        assert!(verify_dependencies(Some(&dependency), Some(&capability.to_string())).is_err());
    }

    #[test]
    fn assets_are_written_from_the_binary_into_owned_scratch() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let assets = scratch.path.join("oracle-assets");
        let entry = materialize(&assets).unwrap();
        assert_eq!(entry, assets.join("oracle-emit.ts"));
        assert_eq!(
            std::fs::read_to_string(entry).unwrap(),
            include_str!("../oracle-emit.ts")
        );
        assert_eq!(
            std::fs::read_to_string(assets.join("oracle-loader.ts")).unwrap(),
            include_str!("../oracle-loader.ts")
        );
        assert_eq!(
            std::fs::read_to_string(assets.join("oracle-filesystem.ts")).unwrap(),
            include_str!("../oracle-filesystem.ts")
        );
        assert_eq!(
            std::fs::read_to_string(assets.join("oracle-toolchain.json")).unwrap(),
            include_str!("../oracle-toolchain.json")
        );
        assert_eq!(
            std::fs::read_to_string(assets.join("package.json")).unwrap(),
            "{\"type\":\"module\"}\n"
        );
    }

    fn manifest_fixture() -> (super::super::Scratch, Utf8PathBuf, Utf8PathBuf, Utf8PathBuf) {
        use serde_json::json;
        let scratch = super::super::Scratch::for_check().unwrap();
        let source = scratch.path.join("main.ts");
        let project = scratch.path.join("tsconfig.json");
        std::fs::write(&source, "export function value():number { return 7; }\n").unwrap();
        std::fs::write(&project, "{\"files\":[\"main.ts\"]}\n").unwrap();
        let session = scratch.path.join("prepared");
        let assets = session.join("assets");
        materialize(&assets).unwrap();
        std::fs::create_dir_all(session.join("program")).unwrap();
        let emitted = session.join("program/main.js");
        std::fs::write(&emitted, "export function value() { return 7; }\n").unwrap();
        let index = session.join("source-index.json");
        std::fs::write(
            &index,
            serde_json::to_vec(&json!({"version":1,"files":[
                {"source":source,"output":"program/main.js","group":"program"}
            ]}))
            .unwrap(),
        )
        .unwrap();
        let record: Value = serde_json::from_str(include_str!("../oracle-toolchain.json")).unwrap();
        let pin = &record["platforms"][platform_key()];
        let mut typescript = serde_json::Map::new();
        for key in [
            "version",
            "rootPackageSha256",
            "packageSha256",
            "nativeSha256",
            "nativePackageSha256",
        ] {
            typescript.insert(key.to_owned(), pin[key].clone());
        }
        let mut inputs = serde_json::Map::new();
        for file in [&source, &project] {
            inputs.insert(
                file.to_string(),
                digest(&std::fs::read(file).unwrap()).into(),
            );
        }
        let manifest = session.join("manifest.json");
        let observations = inputs
            .iter()
            .map(|(path, value)| serde_json::json!({"kind":"file","path":path,"value":value}))
            .collect::<Vec<_>>();
        let mut stored = json!({"version":3,"observations":observations,"status":"complete","entry":source,"project":project,"roots":null,
            "identity":{"version":1,"typescript":typescript,"executionSha256":super::super::oracle_run::execution_identity().unwrap(),"emitterSha256":digest(include_bytes!("../oracle-emit.ts")),
                "assetsSha256":digest(include_bytes!("../oracle-assets.ts")),"loaderSha256":digest(include_bytes!("../oracle-loader.ts")),"filesystemSha256":digest(include_bytes!("../oracle-filesystem.ts")),"runtimeSha256":digest(include_bytes!("../oracle-runtime.ts")),"resolutionSha256":digest(include_bytes!("../oracle-resolution.ts")),"toolchainRecordSha256":digest(include_bytes!("../oracle-toolchain.json")),"options":record["execution"]["options"]},
            "inputs":inputs,"outputs":{"program/main.js":digest(&std::fs::read(&emitted).unwrap()),"source-index.json":digest(&std::fs::read(&index).unwrap())},
            "groups":[{"entry":source,"project":project,"output":"program","compilerStatus":0}]
        });
        let mut runtime_assets = serde_json::Map::new();
        for name in ["loader", "runtime", "assets"] {
            let route = format!("assets/oracle-{name}.mjs");
            let code = format!("// owned protocol fixture: {name}\nexport {{}};\n");
            std::fs::write(session.join(&route), &code).unwrap();
            runtime_assets.insert(route, Value::String(digest(code.as_bytes())));
        }
        stored["runtimeAssets"] = Value::Object(runtime_assets);
        stored["runtimeIndex"] = snapshot_index_fixture(&session, &stored);
        std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
        (scratch, manifest, source, project)
    }

    fn snapshot_index_fixture(session: &Utf8Path, stored: &Value) -> Value {
        use serde_json::json;
        let put = |bytes: &[u8], extension: &str| {
            let hash = digest(bytes);
            let path = format!("runtime-index/{hash}.{extension}");
            std::fs::create_dir_all(session.join("runtime-index")).unwrap();
            std::fs::write(session.join(&path), bytes).unwrap();
            json!({"path":path,"sha256":hash})
        };
        let mut bucket = serde_json::to_vec(&json!({"version":1,"slot":0,
            "entries":[["descriptor",{"version":1,"identity":stored["identity"],
                "runtimeAssets":stored["runtimeAssets"]}]]}))
        .unwrap();
        bucket.push(b'\n');
        let mut table = [0_u8; 40];
        let length = u32::try_from(bucket.len()).unwrap();
        table[4..8].copy_from_slice(&length.to_le_bytes());
        table[8..].copy_from_slice(&hmac_sha256::Hash::hash(&bucket));
        let mut data = put(&bucket, "bin");
        data["bytes"] = bucket.len().into();
        let mut descriptor = serde_json::to_vec(&json!({"version":2,"slots":1,
            "slotBytes":40,"table":put(&table,"bin"),"data":data}))
        .unwrap();
        descriptor.push(b'\n');
        put(&descriptor, "json")
    }

    #[test]
    fn snapshot_handoff_binds_exact_manifest_and_runtime_root_bytes() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        let bytes = std::fs::read(&manifest).unwrap();
        let stored: Value = serde_json::from_slice(&bytes).unwrap();
        let prepared = read_prepared(&manifest, &source, &project).unwrap();
        assert_eq!(prepared.snapshot["manifestSha256"], digest(&bytes));
        assert_eq!(prepared.snapshot["index"], stored["runtimeIndex"]);
        assert!(bind_snapshot(&manifest, &bytes, &Value::Null).is_err());
        let mut outside = stored["runtimeIndex"].clone();
        outside["path"] = "../outside.json".into();
        assert!(bind_snapshot(&manifest, &bytes, &outside).is_err());
        let root = manifest
            .parent()
            .unwrap()
            .join(stored["runtimeIndex"]["path"].as_str().unwrap());
        std::fs::write(&root, b"changed").unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
    }

    #[test]
    fn parent_snapshot_finalization_replays_originals_even_after_ready() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        let prepared = read_prepared(&manifest, &source, &project).unwrap();
        finish_snapshot(&prepared).unwrap();
        std::fs::write(&source, "export const changed = true;\n").unwrap();
        let error = finish_snapshot(&prepared).unwrap_err().to_string();
        assert!(
            error.contains("oracle snapshot finalization held"),
            "{error}"
        );
        assert!(error.contains("oracle filesystem file changed"), "{error}");
    }

    #[test]
    fn prepared_handoff_requires_a_clean_compiler_and_bound_source_index() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        let original = std::fs::read(&manifest).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        for status in [1, 2, 3] {
            let mut changed: Value = serde_json::from_slice(&original).unwrap();
            changed["groups"][0]["compilerStatus"] = status.into();
            std::fs::write(&manifest, serde_json::to_vec(&changed).unwrap()).unwrap();
            assert!(read_prepared(&manifest, &source, &project).is_err());
        }
        let mut changed: Value = serde_json::from_slice(&original).unwrap();
        changed["groups"][0]["project"] = "unobserved-project.json".into();
        std::fs::write(&manifest, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        let mut changed: Value = serde_json::from_slice(&original).unwrap();
        changed["outputs"]
            .as_object_mut()
            .unwrap()
            .remove("source-index.json");
        std::fs::write(&manifest, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        std::fs::write(&manifest, &original).unwrap();
        std::fs::write(
            manifest.parent().unwrap().join("source-index.json"),
            "changed index",
        )
        .unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
    }

    #[test]
    fn prepared_handoff_binds_embedded_assets_current_roots_and_completed_output() {
        use serde_json::json;
        let (_scratch, manifest, source, project) = manifest_fixture();
        let original = std::fs::read(&manifest).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        for (field, value) in [
            ("status", json!("pending")),
            ("version", json!(1)),
            ("entry", json!("another.ts")),
            ("project", json!("another.json")),
            ("roots", json!(["another.ts"])),
            ("groups", json!([])),
            ("observations", json!([])),
        ] {
            let mut changed: Value = serde_json::from_slice(&original).unwrap();
            changed[field] = value;
            std::fs::write(&manifest, serde_json::to_vec(&changed).unwrap()).unwrap();
            assert!(
                read_prepared(&manifest, &source, &project).is_err(),
                "{field}"
            );
        }
        let mut changed: Value = serde_json::from_slice(&original).unwrap();
        changed.as_object_mut().unwrap().remove("roots");
        std::fs::write(&manifest, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        std::fs::write(&manifest, &original).unwrap();
        let session = manifest.parent().unwrap();
        std::fs::write(session.join("assets/oracle-loader.ts"), "changed loader").unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        std::fs::write(
            session.join("assets/oracle-loader.ts"),
            include_str!("../oracle-loader.ts"),
        )
        .unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        let filesystem = session.join("assets/oracle-filesystem.ts");
        std::fs::write(&filesystem, "changed filesystem adapter").unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        std::fs::write(filesystem, include_str!("../oracle-filesystem.ts")).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        std::fs::write(session.join("program/main.js"), "different output").unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
    }

    #[test]
    fn prepared_handoff_refuses_changed_sources_and_options_without_an_oracle_fallback() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        let bytes = std::fs::read(&source).unwrap();
        std::fs::write(&source, "export function value():number { return 8; }\n").unwrap();
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem file changed")
        );
        std::fs::write(&source, bytes).unwrap();
        std::fs::write(&project, "{\"compilerOptions\":{\"target\":\"ES2020\"}}\n").unwrap();
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem file changed")
        );
    }

    #[test]
    fn prepared_input_join_visits_grow_linearly() {
        let mut measured = Vec::new();
        for count in [16usize, 64, 256] {
            let (scratch, manifest, source, project) = manifest_fixture();
            let mut stored: Value =
                serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            for index in 2..count {
                let path = scratch.path.join(format!("input-{index:04}.ts"));
                std::fs::write(&path, "export const value:number=7;").unwrap();
                stored["inputs"][path.as_str()] = digest(&std::fs::read(&path).unwrap()).into();
            }
            let observations = stored["inputs"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(path, value)| serde_json::json!({"kind":"file","path":path,"value":value}))
                .collect::<Vec<_>>();
            assert_eq!(observations.len(), count);
            stored["observations"] = observations.into();
            std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
            INPUT_JOIN_VISITS.with(|visits| visits.set(0));
            assert!(read_prepared(&manifest, &source, &project).is_ok());
            measured.push((count, INPUT_JOIN_VISITS.with(std::cell::Cell::get)));
        }
        eprintln!("actual read_prepared input-observation visits: {measured:?}");
        assert!(
            measured
                .iter()
                .all(|(count, visits)| (*count..=2 * count).contains(visits)),
            "missing instrumentation or quadratic observation join: {measured:?}"
        );
    }

    #[test]
    fn prepared_input_index_keeps_duplicate_and_matching_hash_checks() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        let original: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        let mut duplicate = original.clone();
        let same = duplicate["observations"][0].clone();
        duplicate["observations"].as_array_mut().unwrap().push(same);
        std::fs::write(&manifest, serde_json::to_vec(&duplicate).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        let mut conflicting = duplicate.clone();
        conflicting["observations"][0]["value"] = "0".repeat(64).into();
        std::fs::write(&manifest, serde_json::to_vec(&conflicting).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_err());
        let mut unmatched = original;
        unmatched["inputs"][source.as_str()] = "0".repeat(64).into();
        std::fs::write(&manifest, serde_json::to_vec(&unmatched).unwrap()).unwrap();
        assert!(
            read_prepared(&manifest, &source, &project)
                .err()
                .unwrap()
                .to_string()
                .contains("input has no matching filesystem observation")
        );
    }

    #[test]
    fn prepared_handoff_revalidates_failed_lookups_and_consulted_directory_results() {
        for kind in ["fileExists", "directoryExists", "entries"] {
            let (scratch, manifest, source, project) = manifest_fixture();
            let path = scratch.path.join("observed");
            if kind == "entries" {
                std::fs::create_dir(&path).unwrap();
            }
            let value = if kind == "entries" {
                serde_json::json!({"files":[],"directories":[]})
            } else {
                Value::Bool(false)
            };
            let mut stored: Value =
                serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            stored["observations"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({"kind":kind,"path":path,"value":value}));
            std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
            assert!(
                read_prepared(&manifest, &source, &project).is_ok(),
                "unchanged {kind}"
            );
            match kind {
                "fileExists" => std::fs::write(&path, "appeared").unwrap(),
                "directoryExists" => std::fs::create_dir(&path).unwrap(),
                _ => std::fs::write(path.join("appeared.ts"), "export {};").unwrap(),
            }
            let failure = format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            );
            assert!(
                failure.contains(&format!("filesystem {kind} changed")),
                "{failure}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn prepared_handoff_revalidates_the_realpath_answer() {
        let (scratch, manifest, source, project) = manifest_fixture();
        let alias = scratch.path.join("alias");
        std::os::unix::fs::symlink(&source, &alias).unwrap();
        let mut stored: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        stored["observations"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"kind":"realpath","path":alias,"value":source}));
        std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        std::fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(&project, &alias).unwrap();
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem realpath changed")
        );
    }

    #[cfg(unix)]
    #[test]
    fn prepared_handoff_revalidates_link_text_when_realpath_is_unchanged() {
        let (scratch, manifest, source, project) = manifest_fixture();
        for path in [&source, &scratch.path.join("absent")] {
            assert_eq!(
                host_answer(&HostObservation {
                    kind: ObservationKind::Readlink,
                    path: path.clone(),
                    value: Value::Null,
                })
                .unwrap(),
                Value::Null
            );
        }
        let alias = scratch.path.join("alias");
        std::os::unix::fs::symlink(&source, &alias).unwrap();
        let mut stored: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        stored["observations"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"kind":"readlink","path":alias,"value":source}));
        std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        let physical = alias.canonicalize_utf8().unwrap();
        std::fs::remove_file(&alias).unwrap();
        let target = format!(
            "{}/./{}",
            source.parent().unwrap(),
            source.file_name().unwrap()
        );
        std::os::unix::fs::symlink(target, &alias).unwrap();
        assert_eq!(alias.canonicalize_utf8().unwrap(), physical);
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem readlink changed")
        );
    }

    #[test]
    fn prepared_handoff_refuses_unknown_or_malformed_host_observations() {
        let (_scratch, manifest, source, project) = manifest_fixture();
        let original: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        for observation in [
            serde_json::json!({"kind":"unknown","path":source,"value":false}),
            serde_json::json!({"kind":"fileExists","path":source,"value":"true"}),
            serde_json::json!({"kind":"readlink","path":source,"value":true}),
            serde_json::json!({"kind":"runtimeEntries","path":source,"value":["../escape"]}),
            serde_json::json!({"kind":"runtimeKind","path":source,"value":"device"}),
            serde_json::json!({"kind":"file","path":"relative","value":null}),
            serde_json::json!({"kind":"entries","path":source,"value":{"files":[],"directories":[],"extra":1}}),
        ] {
            let mut stored = original.clone();
            stored["observations"]
                .as_array_mut()
                .unwrap()
                .push(observation);
            std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
            assert!(read_prepared(&manifest, &source, &project).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn prepared_runtime_listing_keeps_dangling_links_and_revalidates_presence() {
        let (scratch, manifest, source, project) = manifest_fixture();
        let directory = scratch.path.join("literal");
        std::fs::create_dir(&directory).unwrap();
        let link = directory.join("dangling");
        let target = directory.join("missing");
        std::os::unix::fs::symlink("missing", &link).unwrap();
        let mut stored: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        for observation in [
            serde_json::json!({"kind":"runtimeEntries","path":directory,"value":["dangling"]}),
            serde_json::json!({"kind":"runtimeKind","path":link,"value":"symlink"}),
            serde_json::json!({"kind":"runtimeKind","path":target,"value":null}),
        ] {
            stored["observations"]
                .as_array_mut()
                .unwrap()
                .push(observation);
        }
        std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        std::fs::write(&target, "appeared").unwrap();
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem runtimeEntries changed")
        );
        std::fs::remove_file(&target).unwrap();
        std::fs::remove_file(&link).unwrap();
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem runtimeEntries changed")
        );
    }

    #[cfg(unix)]
    #[test]
    fn prepared_runtime_kind_rejects_changed_kind_with_identical_names() {
        let (scratch, manifest, source, project) = manifest_fixture();
        let directory = scratch.path.join("literal");
        std::fs::create_dir(&directory).unwrap();
        let link = directory.join("entry");
        std::os::unix::fs::symlink("absent", &link).unwrap();
        let mut stored: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        stored["observations"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"kind":"runtimeKind","path":link,"value":"symlink"}));
        std::fs::write(&manifest, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read_prepared(&manifest, &source, &project).is_ok());
        let before = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        std::fs::remove_file(&link).unwrap();
        std::fs::write(&link, "replacement").unwrap();
        let after = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(before, after);
        assert!(
            format!(
                "{:#}",
                read_prepared(&manifest, &source, &project).err().unwrap()
            )
            .contains("filesystem runtimeKind changed")
        );
    }

    #[test]
    fn child_event_grammar_matches_the_shared_javascript_rows() {
        let matrix: Value =
            serde_json::from_str(include_str!("../oracle-child-events.json")).unwrap();
        assert_eq!(matrix["version"], 1);
        let scratch = super::super::Scratch::for_check().unwrap();
        let path = scratch.path.join("events.jsonl");
        for row in matrix["rows"].as_array().unwrap() {
            std::fs::write(&path, row["raw"].as_str().unwrap()).unwrap();
            assert_eq!(
                read_loader_events(std::fs::File::open(&path).unwrap()).is_ok(),
                row["ready"].as_bool().unwrap(),
                "{}",
                row["name"]
            );
        }
    }

    #[test]
    fn every_child_bootstrap_reservation_completes_once() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let state = scratch.path.join("events.jsonl");
        std::fs::write(&state, "").unwrap();
        let ready = "{\"version\":1,\"status\":\"ready\"}\n";
        let start = "{\"version\":1,\"status\":\"child-start\",\"execution\":\"execution-one\"}\n";
        let end = "{\"version\":1,\"status\":\"child-begin\",\"execution\":\"execution-one\"}\n{\"version\":1,\"status\":\"child-ready\",\"execution\":\"execution-one\"}\n";
        for raw in [
            "{\"version\":1.0,\"status\":\"ready\"}\n".to_owned(),
            "{\"version\":1e0,\"status\":\"ready\"}\n".to_owned(),
            ready.to_owned(),
            format!("{ready}{start}{end}"),
            format!("{start}{ready}{end}"),
        ] {
            std::fs::remove_file(&state).unwrap();
            let mut owned = ExecutionState::create(state.clone()).unwrap();
            std::fs::write(&state, raw).unwrap();
            assert!(ensure_loaded(&mut owned).is_ok());
        }
        for raw in [
            "{\"version\":\"1\",\"status\":\"ready\"}\n".to_owned(),
            "{\"version\":true,\"status\":\"ready\"}\n".to_owned(),
            format!("{ready}{start}"),
            format!("{ready}{end}"),
            format!("{ready}{start}{start}{end}"),
            format!("{ready}{start}{end}{end}"),
            format!(
                "{ready}{start}{{\"version\":1,\"status\":\"child-ready\",\"execution\":\"execution-two\"}}\n"
            ),
            format!(
                "{ready}{{\"version\":1,\"status\":\"child-start\",\"execution\":\"execution-\"}}\n"
            ),
            format!(
                "{ready}{{\"version\":1,\"status\":\"child-start\",\"execution\":\"execution-one/child\"}}\n"
            ),
            format!("{ready}{{\"version\":1,\"status\":\"child-start\",\"execution\":1}}\n"),
            format!(
                "{ready}{{\"version\":1,\"status\":\"child-start\",\"execution\":\"execution-one\",\"extra\":true}}\n"
            ),
            format!("{ready}{start}{end}").trim_end().to_owned(),
            format!(
                "{ready}{start}{end}{{\"version\":1,\"status\":\"instrument\",\"reason\":\"child failed after bootstrap\"}}\n"
            ),
        ] {
            std::fs::remove_file(&state).unwrap();
            let mut owned = ExecutionState::create(state.clone()).unwrap();
            std::fs::write(&state, raw).unwrap();
            assert!(ensure_loaded(&mut owned).is_err());
        }
    }

    #[test]
    fn retained_event_reader_survives_path_replacement_and_caches_its_result() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let path = scratch.path.join("events.jsonl");
        let mut owned = ExecutionState::create(path.clone()).unwrap();
        std::fs::write(&path, "{\"version\":1,\"status\":\"ready\"}\n").unwrap();
        let original = scratch.path.join("original.jsonl");
        std::fs::rename(&path, &original).unwrap();
        std::fs::write(&path, "{\"version\":1,\"status\":\"ready\"}\n").unwrap();
        std::fs::write(&original,"{\"version\":1,\"status\":\"ready\"}\n{\"version\":1,\"status\":\"instrument\",\"reason\":\"original stream owner\"}\n").unwrap();
        let first = format!("{:#}", ensure_loaded(&mut owned).unwrap_err());
        assert!(first.contains("original stream owner"));
        assert!(owned.reader.is_none());
        std::fs::write(&original, "{\"version\":1,\"status\":\"ready\"}\n").unwrap();
        assert_eq!(
            format!("{:#}", ensure_loaded(&mut owned).unwrap_err()),
            first
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn owned_event_descriptors_close_on_all_paths() {
        const CONTROL: &str = "NTS_ORACLE_EVENT_FD_CONTROL";
        if std::env::var_os(CONTROL).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "oracle_emit::tests::owned_event_descriptors_close_on_all_paths",
                    "--test-threads=1",
                ])
                .env(CONTROL, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                String::from_utf8_lossy(&output.stdout).contains("1 passed"),
                "descriptor control did not execute"
            );
            return;
        }
        let scratch = super::super::Scratch::for_check().unwrap();
        let count = || std::fs::read_dir("/proc/self/fd").unwrap().count();
        let before = count();
        for index in 0..64 {
            let path = scratch.path.join(format!("events-{index}.jsonl"));
            let mut owned = ExecutionState::create(path.clone()).unwrap();
            assert_eq!(count(), before + 1);
            match index % 4 {
                0 => {
                    std::fs::write(&path, "{\"version\":1,\"status\":\"ready\"}\n").unwrap();
                    ensure_loaded(&mut owned).unwrap();
                }
                1 => {
                    std::fs::write(&path, "{").unwrap();
                    assert!(ensure_loaded(&mut owned).is_err());
                }
                2 => {
                    assert!(
                        std::process::Command::new(scratch.path.join("missing-node"))
                            .status()
                            .is_err()
                    );
                }
                _ => {
                    let error: Result<()> = Err(anyhow::anyhow!("owned descriptor error control"));
                    assert!(error.is_err());
                }
            }
            drop(owned);
            assert_eq!(count(), before);
        }
    }

    #[test]
    fn completed_application_output_cannot_mask_loader_failure() {
        let scratch = super::super::Scratch::for_check().unwrap();
        let state = scratch.path.join("loader-state.json");
        let mut owned = ExecutionState::create(state.clone()).unwrap();
        let prepared = Prepared {
            manifest: scratch.path.join("manifest.json"),
            loader_state: state.clone(),
            identity: Value::Null,
            snapshot: Value::Null,
            args: Vec::new(),
            assets: scratch.path.clone(),
        };
        assert!(ensure_loaded(&mut owned).is_err());
        let ready = "{\"version\":1,\"status\":\"ready\"}\n";
        let instrument = "{\"version\":1,\"status\":\"instrument\",\"reason\":\"emit failed\"}\n";
        std::fs::remove_file(&state).unwrap();
        let mut owned = ExecutionState::create(state.clone()).unwrap();
        std::fs::write(&state, ready).unwrap();
        assert!(ensure_loaded(&mut owned).is_ok());
        let first = execution_state(&prepared).unwrap();
        let second = execution_state(&prepared).unwrap();
        assert_ne!(first.path, second.path);
        for value in [
            format!("{ready}{instrument}"),
            format!("{instrument}{ready}"),
            String::new(),
            "{}\n".into(),
            "[]\n".into(),
            "{\n".into(),
            ready.trim_end().into(),
            format!("{ready}\n"),
            r#"{"version":1,"status":"instrument","reason":"emit failed"}"#.into(),
            "{\"version\":1,\"status\":\"ready\",\"unexpected\":true}\n".into(),
            "{\"version\":2,\"status\":\"ready\"}\n".into(),
        ] {
            std::fs::remove_file(&state).unwrap();
            let mut owned = ExecutionState::create(state.clone()).unwrap();
            std::fs::write(&state, value).unwrap();
            assert!(ensure_loaded(&mut owned).is_err());
        }
    }
}
