//! Producers pass observations to TypeScript; it alone validates, publishes and renders records.
use anyhow::{Context, Result, ensure};
use camino::Utf8Path;
use std::io::Write;

/// Append-only recovery for a session whose current case cannot finish. Flush
/// each complete frame before announcing its row; publication still uses the
/// shared record authority, including all its checksum and workload checks.
pub(super) struct Journal(std::fs::File);

impl Journal {
    pub(super) fn create(path: &str, header: &serde_json::Value) -> Result<Self> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .with_context(|| format!("creating benchmark journal {path}"))?;
        let mut journal = Self(file);
        journal.append(header)?;
        Ok(journal)
    }

    pub(super) fn append(&mut self, frame: &serde_json::Value) -> Result<()> {
        serde_json::to_writer(&mut self.0, frame)?;
        self.0.write_all(b"\n")?;
        self.0
            .sync_data()
            .context("committing benchmark journal frame")
    }
}

pub(super) fn command(root: &Utf8Path, mode: &str, args: &[&str]) -> Result<String> {
    let output = std::process::Command::new("node")
        .arg(root.join("tooling/bench/run-session.ts"))
        .arg(mode)
        .arg(root)
        .args(args)
        .current_dir(root)
        .output()
        .context("running the benchmark record authority")?;
    ensure!(
        output.status.success(),
        "benchmark record authority: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(String::from_utf8(output.stdout)
        .context("benchmark record output is not UTF-8")?
        .trim()
        .to_owned())
}

/// A foundation group's rows, read from the canonical declaration by the
/// shared authority before anything is set up or measured.
pub(super) fn group_cases(root: &Utf8Path, name: &str) -> Result<Vec<String>> {
    serde_json::from_str(&command(root, "group", &[name])?).context("invalid benchmark group rows")
}

pub(super) fn begin(root: &Utf8Path) -> Result<serde_json::Value> {
    ensure!(
        env!("NTS_BENCH_SOURCE_DIRTY") == "false",
        "nts-bench was built from dirty sources; commit and rebuild"
    );
    let binary = std::env::current_exe().context("benchmark executable path")?;
    let binary = binary.to_str().context("benchmark path is not UTF-8")?;
    let text = command(root, "begin", &[binary, env!("NTS_BENCH_SOURCE_COMMIT")])?;
    serde_json::from_str(&text).context("invalid benchmark run metadata")
}

pub(super) fn conditions(root: &Utf8Path) -> Result<serde_json::Value> {
    serde_json::from_str(&command(root, "conditions", &[])?)
        .context("invalid benchmark machine conditions")
}

pub(super) fn host_measured(
    hosts: &serde_json::Value,
    column: &str,
) -> Result<Option<super::Measured>> {
    let cell = &hosts["cells"][column];
    if cell["status"] != "OK" {
        return Ok(None);
    }
    let value = serde_json::json!({"ns_per_op":cell["nanoseconds"],"checksum":cell["checksum"],"spread":cell["spread"],"warm_capped":false,"instructions":cell["instructions"],"counted_reps":cell["counted_reps"]});
    Ok(Some(
        serde_json::from_value(value).context("invalid host observation")?,
    ))
}

/// The console is another view of the same validated row, not a second verdict policy.
pub(super) fn print_row(
    root: &Utf8Path,
    metadata: &serde_json::Value,
    measured: &super::Measurements,
    lanes: Option<&[String]>,
    failure: Option<&super::RowFailure>,
) -> Result<()> {
    let failures = failure.map_or_else(
        || serde_json::json!({}),
        |f| serde_json::json!({measured.shown.clone():f}),
    );
    let raw = serde_json::json!({"metadata":metadata,"cases":[measured.shown],"measured":[measured],"lanes":lanes,"spoiled":[],"failed":[],"row_failures":failures});
    let path = root
        .join("target/bench")
        .join(format!("{}.row.json", measured.shown));
    std::fs::write(&path, serde_json::to_string(&raw)?)?;
    println!("{}", command(root, "row", &[path.as_str()])?);
    Ok(())
}
