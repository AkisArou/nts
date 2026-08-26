//! The `nts` command-line interface.
//!
//! Commands are added as the capability behind them becomes real. A command that
//! prints a plausible result for something the compiler cannot yet do is worse
//! than no command: RFC §4.1 requires that unsupported reachable behavior be
//! diagnosed precisely, and that promise starts here.

use anyhow::{Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo, tsgo::decompose::Budget};
use nts_semantic_schema::SCHEMA_VERSION;

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("frontend") => {
            let rest: Vec<String> = args.collect();
            let decompose = rest.iter().any(|a| a == "--decompose");
            let tsconfig = rest
                .iter()
                .find(|a| !a.starts_with("--"))
                .map_or_else(|| Utf8PathBuf::from("tsconfig.json"), Utf8PathBuf::from);
            frontend(&tsconfig, decompose)
        }
        Some("version") | None => {
            println!("nts {}", env!("CARGO_PKG_VERSION"));
            println!("snapshot schema v{SCHEMA_VERSION}");
            println!("pinned tsgo {}", tsgo::PINNED_TSGO);
            Ok(())
        }
        Some(other) => bail!("unknown command `{other}`; try `nts version`"),
    }
}

/// Run the frontend against a project and report what it cost.
///
/// This exists before `nts build` on purpose. Gate G1 is the measurement that
/// validates the `tsgo --api` transport decision, and a gate nobody can run is
/// not a gate.
fn frontend(tsconfig: &Utf8Path, decompose: bool) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::new(tsgo_binary);
    if decompose {
        source = source.with_decomposition(Budget::DEFAULT);
    }

    let snapshot = source.snapshot(tsconfig)?;
    let stats = source.stats();

    println!("files            {}", stats.files);
    println!("nodes decoded    {}", stats.nodes_decoded);
    println!("types resolved   {}", stats.types_resolved);
    println!("  distinct       {}", stats.distinct_types);
    println!("symbols          {}", stats.symbols);
    println!("modules          {}", stats.modules);
    if decompose {
        println!("  decomposed     {}", stats.decomposed);
        if stats.decomposition_exhausted {
            println!("  NOTE           budget exhausted; the type graph is partial");
        }
    }
    println!("round trips      {}", stats.round_trips);
    println!("  per file       {:.2}", stats.round_trips_per_file());
    println!("elapsed          {} ms", stats.elapsed_ms);
    println!("snapshot digest  {}", hex(&snapshot.digest()?));

    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}
