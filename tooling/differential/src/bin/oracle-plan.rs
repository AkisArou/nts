//! Gate tooling's pool inventory; no native arm or oracle is executed.
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
    let plan = nts_differential::oracle_plan(&config, &mut frontend, Backend::from_environment()?)?;
    serde_json::to_writer(std::io::stdout(), &plan)?;
    println!();
    Ok(())
}
