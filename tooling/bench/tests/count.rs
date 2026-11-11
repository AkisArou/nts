//! `--count` over one small case, counted twice: the columns it prints and
//! the agreement two runs of an unchanged build stay inside.

use anyhow::{Context, Result, ensure};

/// The band the counted header states (`COUNT_NOISE_PERCENT` in main.rs),
/// in basis points: bracketed counts vary only with background JIT/runtime
/// threads.
const NOISE_BAND_BASIS_POINTS: u64 = 300;

fn root() -> Result<camino::Utf8PathBuf> {
    camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .context("workspace root")
}

fn count(args: &[&str]) -> Result<std::process::Output> {
    let root = root()?;
    std::process::Command::new(env!("CARGO_BIN_EXE_nts-bench"))
        .arg("--root")
        .arg(root.as_str())
        .args(args)
        .current_dir(&root)
        .output()
        .context("running nts-bench --count")
}

fn counted_row() -> Result<Vec<u64>> {
    let output = count(&["--count", "fib"])?;
    ensure!(
        output.status.success(),
        "nts-bench --count fib failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout)?;
    let row = text
        .lines()
        .find(|line| line.starts_with("fib\t"))
        .context("no counted fib row")?;
    row.split('\t')
        .skip(1)
        .map(|cell| {
            cell.parse::<u64>()
                .with_context(|| format!("counted cell {cell}"))
        })
        .collect()
}

#[test]
fn an_unknown_group_refuses_before_setup() -> Result<()> {
    let output = count(&["--count", "--group", "no-such-group"])?;
    ensure!(!output.status.success(), "an unknown group was accepted");
    ensure!(
        String::from_utf8_lossy(&output.stderr).contains("unknown benchmark group"),
        "unknown group refusal names the group: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn a_small_case_counted_twice_agrees_within_the_stated_band() -> Result<()> {
    // perf is the instrument; where it cannot count, there is nothing to
    // agree about, and the compile-time gate step says so on its own.
    let probe = std::process::Command::new("perf")
        .args(["stat", "-e", "instructions:u", "--", "true"])
        .output();
    if probe.as_ref().is_err_and(|_| true) || probe.is_ok_and(|out| !out.status.success()) {
        eprintln!("perf cannot count here; counted agreement unmeasured");
        return Ok(());
    }
    let first = counted_row()?;
    let second = counted_row()?;
    assert_eq!(first.len(), 9, "every column counted");
    assert_eq!(first.len(), second.len());
    for (index, (a, b)) in first.iter().zip(&second).enumerate() {
        // Basis points of difference, in integers: the band is 3% = 300.
        let basis = a.abs_diff(*b) * 10_000 / (*b).max(1);
        assert!(
            basis <= NOISE_BAND_BASIS_POINTS,
            "column {index}: {a} vs {b} instructions/op differ by {basis} basis points, past the stated band"
        );
    }
    Ok(())
}
