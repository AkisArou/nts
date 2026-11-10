//! Gate tooling's pool inventory; no native arm or oracle is executed.
//!
//! `oracle-plan <tsconfig>` prints two lines: the entry it plans, as soon as
//! its capture finds it, then the plan. A planner stopped at its CPU bound has
//! printed the first, which names the entry its plan budget is for.
use std::io::Write;

use anyhow::{Context, Result, ensure};
use camino::Utf8PathBuf;
use nts_codegen_common::Backend;
use nts_frontend_ts::Frontend;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--execute") {
        ensure!(
            args.len() == 5,
            "usage: oracle-plan --execute <plan.json> <sha256> <manifest> <owned output>"
        );
        let result = nts_differential::execute_oracle_plan(
            &Utf8PathBuf::from(&args[1]),
            &args[2],
            &Utf8PathBuf::from(&args[3]),
            &Utf8PathBuf::from(&args[4]),
        )?;
        serde_json::to_writer(std::io::stdout(), &result)?;
        println!();
        return Ok(());
    }
    ensure!(
        args.len() == 1,
        "usage: oracle-plan <tsconfig> (NTS_BACKEND selects the backend)"
    );
    let cwd = Utf8PathBuf::from_path_buf(std::env::current_dir()?)
        .map_err(|path| anyhow::anyhow!("non-UTF8 cwd: {}", path.display()))?;
    let config = Utf8PathBuf::from(&args[0])
        .canonicalize_utf8()
        .context("locating project config")?;
    let mut frontend = Frontend::new(cwd);
    let plan = nts_differential::oracle_plan_naming(
        &config,
        &mut frontend,
        Backend::from_environment()?,
        |entry| {
            // Written out before the population is planned, so a stop at the
            // bound cannot lose it.
            let mut out = std::io::stdout().lock();
            serde_json::to_writer(&mut out, entry)?;
            writeln!(out)?;
            out.flush()?;
            Ok(())
        },
    )?;
    serde_json::to_writer(std::io::stdout(), &plan)?;
    println!();
    Ok(())
}
