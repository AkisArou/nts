//! Producers pass observations to TypeScript; it alone validates, publishes and renders records.
use anyhow::{Context, Result, ensure};
use camino::Utf8Path;

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
    let value = serde_json::json!({"ns_per_op":cell["nanoseconds"],"checksum":cell["checksum"],"spread":cell["spread"],"warm_capped":false});
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
