//! `--count` over one small case, counted twice: the columns it prints and
//! the agreement two runs of an unchanged build stay inside.

use anyhow::{Context, Result, ensure};

struct Row {
    names: Vec<String>,
    counts: Vec<u64>,
    bands: std::collections::BTreeMap<String, u64>,
    native: Vec<String>,
}

/// A measured JIT spread describes the sample; it cannot refuse an unrelated
/// landing. Native repeatability remains an instrument wiring requirement.
fn refuses(a: u64, b: u64, band: u64, native: bool) -> bool {
    native && u128::from(a.abs_diff(b)) * 10_000 > u128::from(a.min(b)) * u128::from(band)
}

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

fn counted_row() -> Result<Row> {
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
    let counts = row
        .split('\t')
        .skip(1)
        .map(|cell| {
            cell.parse::<u64>()
                .with_context(|| format!("counted cell {cell}"))
        })
        .collect::<Result<Vec<_>>>()?;
    let names = text
        .lines()
        .find_map(|line| line.strip_prefix("case\t"))
        .context("no column names")?
        .split('\t')
        .map(str::to_owned)
        .collect();
    let bands = serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("noise bands (basis points): "))
            .context("no measured column bands")?,
    )?;
    let native = text
        .lines()
        .find_map(|line| line.strip_prefix("native repeat checks: "))
        .context("no native column declaration")?
        .split(", ")
        .map(str::to_owned)
        .collect();
    Ok(Row {
        names,
        counts,
        bands,
        native,
    })
}

#[test]
fn supplied_counts_refuse_native_drift_but_never_a_jit_tiering_draw() {
    assert!(
        refuses(1_000_000, 1_010_000, 1, true),
        "a native 1% drift exceeds a tight measured band"
    );
    for (a, b) in [(8_989_882, 8_423_963), (8_009_434, 8_278_669)] {
        assert!(
            !refuses(a, b, 0, false),
            "even a JIT draw outside the observed band is informational"
        );
    }
    assert!(!refuses(1_000_000, 1_000_001, 1, true));
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
fn real_count_wiring_checks_every_column_and_only_native_repeatability() -> Result<()> {
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
    assert_eq!(
        first.counts.len(),
        9,
        "every column counted and its checksum accepted"
    );
    assert_eq!(first.names, second.names);
    assert_eq!(first.bands, second.bands);
    assert_eq!(first.native, ["nts C", "nts LLVM", "C++", "ScriptC"]);
    assert_eq!(first.native, second.native);
    for ((name, a), b) in first.names.iter().zip(&first.counts).zip(&second.counts) {
        assert!(*a > 0 && *b > 0, "{name} produced no instruction count");
        let band = *first
            .bands
            .get(name)
            .context("a column has no recorded band")?;
        let native = first.native.contains(name);
        let basis = u128::from(a.abs_diff(*b)) * 10_000 / u128::from((*a).min(*b));
        assert!(
            !refuses(*a, *b, band, native),
            "native {name}: {a} vs {b} differ by {basis} basis points, past measured {band}"
        );
        if !native {
            eprintln!(
                "JIT {name}: observed repeat spread {basis} basis points; recorded {band}; informational"
            );
        }
    }
    Ok(())
}
