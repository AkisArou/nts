//! Measures what the compiler is for.
//!
//! # Why three references and not one
//!
//! "Compiles TypeScript to native code" is only worth doing if the native code
//! is fast, and "fast" is a comparison. Each variant answers a different
//! question, and the interesting answers are the gaps between them:
//!
//! - **C (double)** is hand-written C with TypeScript's semantics — every
//!   `number` an IEEE double. This is the ceiling the compiler is *actually*
//!   trying to reach, and the gap to it is a codegen defect.
//! - **C (int64)** is the C a C programmer would write. The gap between it and
//!   C (double) is not a defect: it is the prize for proving a `number` is
//!   integral, and it prices the `ScriptC` number-facts analysis that
//!   [`nts_core::hir::HirType::NUMBER`] defers.
//! - **Node** is the thing being replaced. The gap to it is the argument for
//!   the project existing.
//!
//! Reaching C (double) means the backend is done. Reaching C (int64) means the
//! *compiler* is done.
//!
//! # Checksums
//!
//! Every variant returns a value and the runner compares them. A benchmark that
//! only measures time rewards a backend for computing the wrong answer quickly,
//! which is the easiest possible way to win.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};

/// One measurement.
struct Measured {
    ns_per_op: f64,
    checksum: String,
}

/// What a variant is called and how it is built.
struct Variant {
    label: &'static str,
    /// The C file supplying `bench_run`, relative to the case directory.
    source: &'static str,
    /// Whether the nts-generated translation unit is linked in too.
    generated: bool,
}

const VARIANTS: &[Variant] = &[
    Variant {
        label: "nts",
        source: "nts.c",
        generated: true,
    },
    Variant {
        label: "C (double)",
        source: "ref-double.c",
        generated: false,
    },
    Variant {
        label: "C (int64)",
        source: "ref-int.c",
        generated: false,
    },
];

fn main() -> Result<()> {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .context("locating the repository root")?;
    let cases_dir = root.join("benches/cases");

    let requested: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();
    let mut cases: Vec<Utf8PathBuf> = std::fs::read_dir(&cases_dir)
        .with_context(|| format!("reading {cases_dir}"))?
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.ok()?.path()).ok())
        .filter(|path| path.is_dir())
        .collect();
    cases.sort();
    if !requested.is_empty() {
        cases.retain(|case| requested.iter().any(|want| case.file_name() == Some(want)));
    }

    let out = root.join("target/bench");
    std::fs::create_dir_all(&out).context("creating the build directory")?;

    println!(
        "{:<14} {:>12} {:>12} {:>12} {:>12}   {:>8} {:>9}",
        "case", "nts", "C (double)", "C (int64)", "node", "nts/C", "node/nts"
    );
    println!("{}", "-".repeat(92));

    for case in &cases {
        match run_case(&root, case, &out) {
            Ok(()) => {}
            Err(error) => println!("{:<14} failed: {error:#}", case.file_name().unwrap_or("?")),
        }
    }
    Ok(())
}

fn run_case(root: &Utf8Path, case: &Utf8Path, out: &Utf8Path) -> Result<()> {
    let name = case.file_name().context("a case needs a name")?;
    let generated = out.join(format!("{name}.generated.c"));
    std::fs::write(&generated, emit(&case.join("tsconfig.json"))?)
        .with_context(|| format!("writing {generated}"))?;

    let mut results = Vec::new();
    for variant in VARIANTS {
        let binary = out.join(format!(
            "{name}.{}",
            variant.label.replace([' ', '(', ')'], "")
        ));
        let mut sources = vec![
            case.join(variant.source),
            root.join("benches/common/main.c"),
        ];
        if variant.generated {
            sources.push(generated.clone());
        }
        compile(root, &sources, &binary)?;
        results.push(measure(&mut std::process::Command::new(&binary))?);
    }

    let node = measure(std::process::Command::new("node").arg(case.join("bench.mjs")))?;

    // Every variant must agree about the answer before any of them is allowed to
    // be fast.
    for (variant, result) in VARIANTS.iter().zip(&results) {
        if result.checksum != node.checksum {
            bail!(
                "{} computed {} but node computed {} — the benchmark is measuring \
                 two different programs",
                variant.label,
                result.checksum,
                node.checksum
            );
        }
    }

    let nts = &results[0];
    let reference = &results[1];
    println!(
        "{name:<14} {:>12} {:>12} {:>12} {:>12}   {:>7.2}x {:>8.1}x",
        human(nts.ns_per_op),
        human(reference.ns_per_op),
        human(results[2].ns_per_op),
        human(node.ns_per_op),
        nts.ns_per_op / reference.ns_per_op,
        node.ns_per_op / nts.ns_per_op,
    );
    Ok(())
}

/// The compiler's own pipeline, not a shell out to the CLI — a benchmark that
/// measured a stale generated file would be worse than no benchmark.
fn emit(tsconfig: &Utf8Path) -> Result<String> {
    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let snapshot = TsgoApi::new(tsgo)
        .with_call_resolution(Budget::DEFAULT)
        .snapshot(tsconfig)?;
    if snapshot.has_errors() {
        bail!("{tsconfig} does not typecheck");
    }

    let prepared = match hir::prepare(&snapshot) {
        Ok(prepared) => prepared,
        Err(problems) => bail!("invalid HIR: {problems:?}"),
    };
    for diagnostic in &prepared.diagnostics {
        eprintln!("  {} {}", diagnostic.code, diagnostic.message);
    }

    let emitted = nts_codegen_c::emit(&prepared.program);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  {} {}", diagnostic.code, diagnostic.message);
    }
    Ok(emitted.writer.text().to_owned())
}

fn compile(root: &Utf8Path, sources: &[Utf8PathBuf], binary: &Utf8Path) -> Result<()> {
    let output = std::process::Command::new("clang")
        // Link-time optimization, for fairness rather than for speed. A
        // reference variant defines its workload and `bench_run` in one
        // translation unit, so without LTO clang inlines one into the other;
        // the nts workload is necessarily in a separate unit and could not be.
        // That gap would show up as a codegen defect that does not exist.
        .args(["-std=c11", "-O2", "-flto", "-Wall", "-Wextra", "-Werror"])
        .arg("-I")
        .arg(root.join("benches/common"))
        .args(sources)
        .arg("-o")
        .arg(binary)
        .arg("-lm")
        .output()
        .context("running clang")?;
    if !output.status.success() {
        bail!("clang: {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(())
}

fn measure(command: &mut std::process::Command) -> Result<Measured> {
    let output = command.output().context("running a benchmark")?;
    if !output.status.success() {
        bail!(
            "benchmark exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut fields = text.split_whitespace();
    let ns_per_op: f64 = fields
        .next()
        .context("no timing on stdout")?
        .parse()
        .context("timing was not a number")?;
    let checksum = fields.next().context("no checksum on stdout")?.to_owned();
    Ok(Measured {
        ns_per_op,
        checksum,
    })
}

/// A duration a person can compare at a glance.
fn human(ns: f64) -> String {
    if ns < 1_000.0 {
        format!("{ns:.1} ns")
    } else if ns < 1_000_000.0 {
        format!("{:.2} us", ns / 1_000.0)
    } else {
        format!("{:.2} ms", ns / 1_000_000.0)
    }
}
