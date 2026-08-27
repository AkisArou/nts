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
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// One measurement.
struct Measured {
    ns_per_op: f64,
    checksum: String,
}

/// Which translation unit, if any, the compiler contributes to a variant.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Generated {
    /// Hand-written C++ only.
    None,
    /// Compiled by nts, number specialization on.
    Specialized,
    /// Compiled by nts with specialization disabled — the same program, every
    /// number an f64. The gap between this and `Specialized` is what the
    /// analysis is worth, measured rather than argued.
    Unspecialized,
}

/// What a variant is called and how it is built.
struct Variant {
    label: &'static str,
    /// The C++ file supplying `bench_run`, relative to the case directory.
    source: &'static str,
    generated: Generated,
}

/// One hand-written reference per case, and it is C++.
///
/// There used to be two, `C (double)` and `C (int)`, because it was not obvious
/// which was a fair ceiling -- and the README carried a footnote apologising for
/// that. The double one was really answering "what does the conservative
/// lowering cost", and `nts f64` answers that better: it measures the compiler's
/// actual output rather than a hand-written simulation of it. So the reference is
/// now singular and means one thing -- what a C++ programmer writes -- and each
/// `ref.cpp` says in a comment why that is what it is for that program.
const VARIANTS: &[Variant] = &[
    Variant {
        label: "nts",
        source: "nts.cpp",
        generated: Generated::Specialized,
    },
    Variant {
        label: "nts f64",
        source: "nts.cpp",
        generated: Generated::Unspecialized,
    },
    Variant {
        label: "C++",
        source: "ref.cpp",
        generated: Generated::None,
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
    // Written once; every case compiles against it.
    std::fs::write(
        out.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .context("writing the runtime header")?;
    std::fs::write(
        out.join(nts_codegen_c::RUNTIME_SOURCE_NAME),
        nts_codegen_c::RUNTIME_SOURCE,
    )
    .context("writing the runtime")?;

    println!(
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>9} {:>9}",
        "case", "C++", "nts", "nts f64", "node", "bun", "nts/C++", "nts/node"
    );
    println!("{}", "-".repeat(102));

    let mut rows = Vec::new();
    for case in &cases {
        match run_case(&root, case, &out) {
            Ok(row) => rows.push(row),
            Err(error) => println!("{:<16} failed: {error:#}", case.file_name().unwrap_or("?")),
        }
    }

    // Only a full run may rewrite the README. A filtered one would leave the
    // table describing a mixture of two machines and two revisions, which is
    // worse than a stale table because it does not look stale.
    if requested.is_empty() && rows.len() == cases.len() {
        write_readme(&root, &rows)?;
        println!("\nREADME updated.");
    } else if !requested.is_empty() {
        println!("\nREADME not updated: a filtered run measures only part of the table.");
    }
    Ok(())
}

/// Rewrite the README's generated benchmark table.
///
/// Between markers rather than appended, so the surrounding prose is written by
/// hand and the numbers never are. A table typed out by a person is a table that
/// drifts from the machine that produced it.
fn write_readme(root: &Utf8Path, rows: &[Row]) -> Result<()> {
    const START: &str = "<!-- benchmarks:start -->";
    const END: &str = "<!-- benchmarks:end -->";

    let mut table = String::new();
    let with_bun = rows.iter().any(|row| row.bun.is_some());
    table.push_str(if with_bun {
        "| case | C++ | nts | nts f64 | V8 | Bun | nts/C++ | nts/V8 |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    } else {
        "| case | C++ | nts | nts f64 | V8 | nts/C++ | nts/V8 |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    });
    for row in rows {
        use std::fmt::Write as _;
        let bun = if with_bun {
            format!(" {} |", row.bun.map_or_else(|| "--".to_owned(), human))
        } else {
            String::new()
        };
        let _ = writeln!(
            table,
            "| {} | {} | **{}** | {} | {} |{bun} {:.2}x | {:.2}x |",
            row.case,
            human(row.cpp),
            human(row.nts),
            human(row.unspecialized),
            human(row.node),
            row.nts / row.cpp,
            row.nts / row.node,
        );
    }

    let legend = "\n\
        Both ratios are nts divided by the other, so **lower is better and 1.00 is \
        parity**: `nts/C++` under 1.00 beats hand-written C++, `nts/V8` under 1.00 \
        beats V8.\n\n\
        `nts f64` is the same TypeScript with number specialization switched off. \
        It is the column that makes a speedup a measurement rather than a claim — \
        one program, compiled two ways, run against each other.\n\n\
        `C++` is one hand-written reference per case, being what a C++ programmer \
        would actually write for that program; each `ref.cpp` says why in a \
        comment. Every variant returns a checksum and the runner refuses to report \
        a case whose variants disagree, so a backend cannot win by computing the \
        wrong answer quickly.\n\n\
        `V8` is node and `Bun` is JavaScriptCore, both running the *same* \
        TypeScript source the compiler consumes — the harness imports the `.ts` \
        directly, so there is no second copy of the program to drift. Both are \
        timed inside their own process after 20,000 warmup iterations, so \
        neither startup nor a cold JIT is in either column, and both must \
        produce the same checksum as everything else. Bun is skipped where it \
        is not installed.\n";

    let path = root.join("README.md");
    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {path}"))?;
    let (Some(from), Some(to)) = (text.find(START), text.find(END)) else {
        bail!("README.md has no benchmark markers");
    };
    let updated = format!("{}{START}\n{table}{legend}{}", &text[..from], &text[to..]);
    std::fs::write(&path, updated).with_context(|| format!("writing {path}"))?;
    Ok(())
}

/// One case's timings, kept so the README can be written from the same numbers
/// the terminal showed.
struct Row {
    case: String,
    cpp: f64,
    nts: f64,
    unspecialized: f64,
    node: f64,
    /// Bun, where it is installed. `None` skips the column rather than
    /// reporting a zero that reads like a win.
    bun: Option<f64>,
}

fn run_case(root: &Utf8Path, case: &Utf8Path, out: &Utf8Path) -> Result<Row> {
    let name = case.file_name().context("a case needs a name")?;
    let tsconfig = case.join("tsconfig.json");

    // A case that allocates per iteration has to say so. Under NoGC it would
    // never free, so a run calibrated to a hundred milliseconds would measure
    // page faults rather than the code -- and the provider is a property of the
    // workload, not of the compiler.
    let provider = match std::fs::read_to_string(case.join("provider")) {
        Ok(text) if text.trim() == "rc" => hir::Provider::ReferenceCounting,
        _ => hir::Provider::NoGc,
    };
    let defines: &[&str] = match provider {
        hir::Provider::ReferenceCounting => &["-DNTS_PROVIDER_RC"],
        hir::Provider::NoGc => &[],
    };
    let shown = match provider {
        hir::Provider::ReferenceCounting => format!("{name} (rc)"),
        hir::Provider::NoGc => name.to_owned(),
    };

    let specialized = out.join(format!("{name}.specialized.c"));
    let plain = out.join(format!("{name}.plain.c"));
    let entry = entry_points(case)?;
    std::fs::write(&specialized, emit(&tsconfig, &entry, true, provider)?)
        .with_context(|| format!("writing {specialized}"))?;
    std::fs::write(&plain, emit(&tsconfig, &entry, false, provider)?)
        .with_context(|| format!("writing {plain}"))?;

    let mut results = Vec::new();
    for variant in VARIANTS {
        let binary = out.join(format!(
            "{name}.{}",
            variant.label.replace([' ', '(', ')'], "")
        ));
        let cpp = vec![
            case.join(variant.source),
            root.join("benches/common/main.cpp"),
        ];
        let mut c = vec![out.join(nts_codegen_c::RUNTIME_SOURCE_NAME)];
        match variant.generated {
            Generated::Specialized => c.push(specialized.clone()),
            Generated::Unspecialized => c.push(plain.clone()),
            Generated::None => {}
        }
        compile(root, &cpp, &c, &binary, defines)?;
        results.push(measure(&mut std::process::Command::new(&binary))?);
    }

    let harness = case.join("bench.mjs");
    let node = measure(std::process::Command::new("node").arg(&harness))?;
    // The same source on the other engine. Bun runs `.ts` natively too, so it
    // imports the identical file rather than a copy that could drift.
    let bun = bun_binary()
        .map(|binary| measure(std::process::Command::new(binary).arg(&harness)))
        .transpose()?;

    // Every variant must agree about the answer before any of them is allowed to
    // be fast.
    for (label, checksum) in VARIANTS
        .iter()
        .map(|variant| variant.label)
        .zip(results.iter().map(|result| result.checksum.as_str()))
        .chain(bun.iter().map(|result| ("bun", result.checksum.as_str())))
    {
        if checksum != node.checksum {
            bail!(
                "{label} computed {checksum} but node computed {} — the benchmark \
                 is measuring two different programs",
                node.checksum
            );
        }
    }

    let row = Row {
        case: shown,
        cpp: results[2].ns_per_op,
        nts: results[0].ns_per_op,
        unspecialized: results[1].ns_per_op,
        node: node.ns_per_op,
        bun: bun.map(|result| result.ns_per_op),
    };
    println!(
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>8.2}x {:>8.2}x",
        row.case,
        human(row.cpp),
        human(row.nts),
        human(row.unspecialized),
        human(row.node),
        row.bun.map_or_else(|| "--".to_owned(), human),
        row.nts / row.cpp,
        row.nts / row.node,
    );
    Ok(row)
}

/// The compiler's own pipeline, not a shell out to the CLI — a benchmark that
/// measured a stale generated file would be worse than no benchmark.
/// Where bun is, if it is anywhere.
///
/// `NTS_BUN` first, then whatever is on `PATH`, then the directory bun's own
/// installer uses -- which is not on a non-interactive `PATH`, so looking only
/// at `PATH` reports "not installed" on a machine where it plainly is.
fn bun_binary() -> Option<Utf8PathBuf> {
    if let Ok(named) = std::env::var("NTS_BUN") {
        return Some(Utf8PathBuf::from(named));
    }
    if std::process::Command::new("bun")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
    {
        return Some(Utf8PathBuf::from("bun"));
    }
    let home = std::env::var("HOME").ok()?;
    let installed = Utf8PathBuf::from(home).join(".bun/bin/bun");
    installed.is_file().then_some(installed)
}

/// What the C harness calls, read off the harness.
///
/// A benchmark is an executable and its entry points are exactly the functions
/// `nts.cpp` declares -- it is the only caller the compiled program has. Taking
/// them from the file rather than fixing a name keeps a case free to call its
/// workload whatever the workload is.
fn entry_points(case: &Utf8Path) -> Result<Vec<String>> {
    let source = std::fs::read_to_string(case.join("nts.cpp"))
        .with_context(|| format!("reading {case}/nts.cpp"))?;
    let mut names = Vec::new();
    let mut inside = false;
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with("extern \"C\"") {
            inside = true;
            continue;
        }
        if inside && line == "}" {
            inside = false;
            continue;
        }
        // `double scan(double seed);` -- the name is what precedes the paren.
        if let Some(open) = line.find('(')
            && inside
            && line.ends_with(");")
            && let Some(name) = line[..open].split_whitespace().last()
        {
            names.push(name.trim_start_matches('*').to_owned());
        }
    }
    if names.is_empty() {
        bail!("{case}/nts.cpp declares no entry point");
    }
    Ok(names)
}

fn emit(
    tsconfig: &Utf8Path,
    entry: &[String],
    specialize: bool,
    provider: hir::Provider,
) -> Result<String> {
    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(tsconfig)?;
    if snapshot.has_errors() {
        bail!("{tsconfig} does not typecheck");
    }

    // A benchmark is an *executable* whose entry point is `work`, and RFC §6.8
    // says an executable's exports are not roots: nothing outside the program
    // can call them, because there is no outside.
    //
    // The default is the library answer, which is right when the product is
    // unknown and wrong here in a way that matters. A class exported so that
    // `main.ts` can import it made every one of its methods a root, and a root
    // is a wall: its parameters are as wide as their declared types, because
    // the next caller is a linker away. `Sieve#sieve(flags, size)` had `size`
    // unbounded and every index in it a double, for a program whose only caller
    // passes 5000.
    //
    // It is the same information the other columns have. clang sees the whole
    // program under LTO with `bench_run` as its entry; V8 sees the module and
    // specializes on the types it observes.
    let prepared = match hir::prepare_with(
        &snapshot,
        &hir::Options {
            specialize_numbers: specialize,
            provider,
            roots: hir::reachable::Roots::Entry(entry),
        },
    ) {
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

/// Build one variant.
///
/// Two languages in one binary: the harness and the hand-written reference are
/// C++, the generated program and the runtime are C. They are compiled
/// separately rather than by letting one driver guess from file extensions,
/// because a `-std=` that applies to the wrong language is the kind of thing
/// that works until it silently does not.
///
/// Everything is built with `-flto`, for fairness rather than for speed. A
/// reference defines its workload and `bench_run` in one translation unit, so
/// without LTO clang inlines one into the other; the nts workload is necessarily
/// in a separate unit and could not be. That gap would show up as a codegen
/// defect that does not exist.
fn compile(
    root: &Utf8Path,
    cpp: &[Utf8PathBuf],
    c: &[Utf8PathBuf],
    binary: &Utf8Path,
    defines: &[&str],
) -> Result<()> {
    const SHARED: &[&str] = &["-O2", "-flto", "-Wall", "-Wextra", "-Werror"];
    let mut includes = vec![
        "-I".to_owned(),
        root.join("benches/common").to_string(),
        "-I".to_owned(),
        root.join("target/bench").to_string(),
    ];
    // Are We Fast Yet's own C++ port, where it has been cloned. As a *system*
    // include: it is somebody else's source, so its warnings are not ours to
    // fix and `-Werror` should not stop on them.
    let awfy = root.join("third_party/are-we-fast-yet/benchmarks/C++/src");
    if awfy.is_dir() {
        includes.push("-isystem".to_owned());
        includes.push(awfy.to_string());
    }

    let mut objects = Vec::new();
    for (driver, standard, sources) in [("clang++", "-std=c++20", cpp), ("clang", "-std=c11", c)] {
        for source in sources {
            let object = binary.with_extension(format!(
                "{}.o",
                source.file_name().unwrap_or("unit").replace('.', "_")
            ));
            let output = std::process::Command::new(driver)
                .args(SHARED)
                .arg(standard)
                .args(defines)
                .args(&includes)
                .arg("-c")
                .arg(source)
                .arg("-o")
                .arg(&object)
                .output()
                .with_context(|| format!("running {driver}"))?;
            if !output.status.success() {
                bail!("{driver}: {}", String::from_utf8_lossy(&output.stderr));
            }
            objects.push(object);
        }
    }

    let link = std::process::Command::new("clang++")
        .args(SHARED)
        .args(&objects)
        .arg("-o")
        .arg(binary)
        .arg("-lm")
        .output()
        .context("linking")?;
    if !link.status.success() {
        bail!("link: {}", String::from_utf8_lossy(&link.stderr));
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
