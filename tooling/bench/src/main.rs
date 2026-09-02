//! Measures what the compiler is for.
//!
//! # What each column answers
//!
//! "Compiles TypeScript to native code" is only worth doing if the native code
//! is fast, and "fast" is a comparison. Each variant answers a different
//! question, and the interesting answers are the gaps between them:
//!
//! - **C++** is one hand-written reference per case, being what a C++
//!   programmer would actually write for that program. It is the ceiling, and
//!   the gap to it is a codegen defect.
//! - **nts f64** is this compiler's own output with number specialization
//!   turned off. The gap between it and `nts` is not a defect: it is the prize
//!   for proving a `number` is integral, and it prices that analysis --
//!   seventeen times on `accumulate`, nine on `checksum`.
//! - **Node** is the thing being replaced. The gap to it is the argument for
//!   the project existing. **Bun** is the same question asked of the other
//!   engine.
//!
//! This used to describe three references including a `C (int64)`, and said
//! that reaching it "means the *compiler* is done". There has been no such
//! column since the two C references became one, eighty lines below -- and a
//! goal was written against the sentence rather than the code, which is what a
//! stale comment costs.
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
    /// The same program through the second backend, as textual LLVM IR.
    ///
    /// A column rather than a mode, because the interesting comparison is
    /// *against the first backend on the same machine in the same run* -- and
    /// because both then have to produce the same checksum as C++, node and
    /// bun, which makes every bench run a cross-backend correctness check as
    /// well as a measurement.
    ///
    /// This is the one variant allowed to be missing. The second backend
    /// refuses what it has not learned, and a case it cannot render is a blank
    /// cell: the C backend's number is still worth having, and the gap is the
    /// point rather than an embarrassment to hide by failing the row.
    Llvm,
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
    Variant {
        label: "nts (llvm)",
        source: "nts.cpp",
        generated: Generated::Llvm,
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
    // Written once; every case compiles against them.
    //
    // Every support file rather than the runtime alone, and unconditionally:
    // one build directory is shared by every case, so writing only what the
    // *current* case needs would leave the next one without it. Which of them
    // reaches a binary is still per-case -- `nts_unicode.c` goes on a command
    // line only when that case's program calls into it.
    for file in nts_codegen_c::support_files(true) {
        file.write(out.as_std_path())
            .with_context(|| format!("writing {}", file.name))?;
    }

    println!(
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>9} {:>9} {:>9}",
        "case",
        "C++",
        "nts C",
        "nts LLVM",
        "nts f64",
        "node",
        "bun",
        "nts/C++",
        "nts/node",
        "nts/bun"
    );
    println!("{}", "-".repeat(124));

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
    // `nts f64` is measured on every run and printed by the tool; it is not
    // published. It answers "what does the analysis buy", which is a question
    // about this compiler's insides rather than about how fast the thing is,
    // and a reader comparing against V8 does not need a column for it.
    table.push_str(if with_bun {
        "| case | C++ | nts (C) | nts (LLVM) | V8 | Bun | nts/C++ | nts/V8 | nts/Bun |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    } else {
        "| case | C++ | nts (C) | nts (LLVM) | V8 | nts/C++ | nts/V8 |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    });
    for row in rows {
        use std::fmt::Write as _;
        let bun = if with_bun {
            format!(" {} |", row.bun.map_or_else(|| "--".to_owned(), human))
        } else {
            String::new()
        };
        let against_bun = if with_bun {
            format!(" {} |", row.against(row.bun))
        } else {
            String::new()
        };
        let _ = writeln!(
            table,
            "| {} | {} | {} | **{}** | {} |{bun} {} | {} |{against_bun}",
            row.case,
            row.cpp.map_or_else(|| "--".to_owned(), human),
            human(row.nts),
            row.llvm.map_or_else(|| "--".to_owned(), human),
            human(row.node),
            row.against(row.cpp),
            row.against(Some(row.node)),
        );
    }

    let legend = "\n\
        Every ratio is nts divided by the other, so **lower is better and 1.00 is \
        parity**: `nts/C++` under 1.00 beats hand-written C++, and `nts/V8` and \
        `nts/Bun` under 1.00 beat those engines.\n\n\
        There are two backends and both are measured, in the same run on the \
        same machine: `nts (C)` is the C backend and `nts (LLVM)` is the LLVM \
        one, which is the primary target and is still learning constructs. A \
        `--` there is a program it refuses, not a program it gets wrong — every \
        variant that *does* run must produce the same checksum as every other, \
        so a bench run is a cross-backend correctness check as well as a \
        measurement.\n\n\
        **The ratios are the LLVM backend's**, because a ratio is a claim about \
        what a program compiled by this compiler costs, and that is the backend \
        a program will be compiled by. Where it refuses one, the ratio is `--` \
        rather than quietly reporting the other backend's number under the same \
        heading.\n\n\
        The suite also measures the same TypeScript with number specialization \
        switched off — one program compiled two ways, which is what makes a \
        speedup a measurement rather than a claim. `cargo run -p nts-bench` \
        prints it; it is not published here, because it answers a question about \
        this compiler's insides rather than about how fast the result is.\n\n\
        `C++` is one hand-written reference per case, being what a C++ programmer \
        would actually write for that program; each `ref.cpp` says why in a \
        comment. Every variant returns a checksum and the runner refuses to report \
        a case whose variants disagree, so a backend cannot win by computing the \
        wrong answer quickly.\n\n\
        **The table keeps the cases this compiler loses.** A benchmark suite that \
        held only its wins would be an advertisement rather than an instrument, and \
        the rows above 1.50x are the work queue: each is a shape where the emitted \
        code costs more than the C++ a person would write, and the reason is worth \
        finding rather than hiding.\n\n\
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
    /// The hand-written reference. `None` where the case has no `ref.cpp`,
    /// which real-world code taken from elsewhere generally will not: writing
    /// a second implementation of it in C++ to have something to divide by is
    /// a correctness burden rather than a reference.
    cpp: Option<f64>,
    nts: f64,
    unspecialized: f64,
    node: f64,
    /// The same program through the second backend. `None` where it refused
    /// the program, which is most of them today and is the honest answer.
    llvm: Option<f64>,
    /// Bun, where it is installed. `None` skips the column rather than
    /// reporting a zero that reads like a win.
    bun: Option<f64>,
}

impl Row {
    /// What the ratios are taken against: the **LLVM** backend, which is the
    /// primary target, and `None` where it refuses the program.
    ///
    /// The C backend is the one that renders every case, so it was the obvious
    /// column to divide by -- and the wrong one. A ratio is a claim about what
    /// a program compiled by this compiler costs, and the backend a program
    /// will be compiled by is the LLVM one. Where it refuses, the row says so
    /// rather than quietly reporting the other backend's number under the same
    /// heading.
    fn primary(&self) -> Option<f64> {
        self.llvm
    }

    /// How this case compares against another runtime: lower is better, 1.00 is
    /// parity, `--` is a program the primary backend does not render yet.
    fn against(&self, other: Option<f64>) -> String {
        match (self.primary(), other) {
            (Some(ours), Some(theirs)) => format!("{ours_over:.2}x", ours_over = ours / theirs),
            _ => "--".to_owned(),
        }
    }
}

/// Which memory provider a case runs under.
///
/// A case that allocates per iteration declares `rc` in a file beside its
/// `tsconfig.json`; the default is `NoGC`, which never frees, so a run calibrated
/// to a hundred milliseconds of work would measure page faults rather than the
/// code.
///
/// `NTS_BENCH_RC=1` overrides that and runs every case under reference counting
/// whatever it declares. `NoGC` is not a scenario any real program has, so what
/// reclamation costs each row is a question this table should be able to answer
/// rather than one it avoids by default -- and the answer was 12x on the row
/// that builds a linked list.
fn provider_for(case: &Utf8Path) -> hir::Provider {
    if std::env::var_os("NTS_BENCH_RC").is_some() {
        return hir::Provider::ReferenceCounting;
    }
    match std::fs::read_to_string(case.join("provider")) {
        Ok(text) if text.trim() == "rc" => hir::Provider::ReferenceCounting,
        _ => hir::Provider::NoGc,
    }
}

/// The runtime translation units every variant of a case links.
///
/// The Unicode tables join them only for a case that converts case: linking
/// them always takes `examples/hello` from 81 KB to 162 KB, and a benchmark
/// binary has no more reason to carry them than any other program.
fn runtime_sources(out: &Utf8Path, needs_unicode: bool) -> Vec<Utf8PathBuf> {
    let mut sources = vec![out.join(nts_codegen_c::RUNTIME_SOURCE_NAME)];
    if needs_unicode {
        sources.push(out.join(nts_codegen_c::UNICODE_SOURCE_NAME));
    }
    sources
}

/// Whether a case's program reaches the Unicode tables.
///
/// Asked of the emitted text rather than of the HIR, because the text is what
/// gets compiled -- the same reason `Emitted::needs_unicode` asks it there.
fn reaches_unicode(source: &str) -> bool {
    source.contains("nts_str_to_lower_case") || source.contains("nts_str_to_upper_case")
}

fn run_case(root: &Utf8Path, case: &Utf8Path, out: &Utf8Path) -> Result<Row> {
    let name = case.file_name().context("a case needs a name")?;
    let tsconfig = case.join("tsconfig.json");

    // A case that allocates per iteration has to say so. Under NoGC it would
    // never free, so a run calibrated to a hundred milliseconds would measure
    // page faults rather than the code -- and the provider is a property of the
    // workload, not of the compiler.
    let provider = provider_for(case);
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
    let rendered = out.join(format!("{name}.specialized.ll"));
    let entry = entry_points(case)?;
    let specialized_text = emit(&tsconfig, &entry, true, provider, false)?;
    let needs_unicode = reaches_unicode(&specialized_text);
    std::fs::write(&specialized, &specialized_text)
        .with_context(|| format!("writing {specialized}"))?;
    std::fs::write(&plain, emit(&tsconfig, &entry, false, provider, false)?)
        .with_context(|| format!("writing {plain}"))?;
    // The second backend is allowed to fail here and further down. Anything it
    // cannot render leaves its column empty rather than taking the row with it.
    let renderable = match emit(&tsconfig, &entry, true, provider, true) {
        Ok(text) => std::fs::write(&rendered, text).is_ok(),
        Err(_) => false,
    };

    let mut results: Vec<Option<Measured>> = Vec::new();
    for variant in VARIANTS {
        let binary = out.join(format!(
            "{name}.{}",
            variant.label.replace([' ', '(', ')'], "")
        ));
        // A case may have no hand-written reference. Real-world code taken from
        // somewhere else is the reason: transcribing a WHATWG decoder into C++
        // to have something to divide by is a second implementation to keep
        // correct, and the row is worth having against node and bun without it.
        // The ratio renders `--`, which is what every other absent column does.
        let source = case.join(variant.source);
        if !source.exists() {
            results.push(None);
            continue;
        }
        let cpp = vec![source, root.join("benches/common/main.cpp")];
        let mut c = runtime_sources(out, needs_unicode);
        match variant.generated {
            Generated::Specialized => c.push(specialized.clone()),
            Generated::Unspecialized => c.push(plain.clone()),
            Generated::Llvm if renderable => c.push(rendered.clone()),
            Generated::Llvm => {
                results.push(None);
                continue;
            }
            Generated::None => {}
        }
        let built = compile(root, &cpp, &c, &binary, defines)
            .and_then(|()| measure(&mut std::process::Command::new(&binary)));
        match built {
            Ok(measured) => results.push(Some(measured)),
            // A refused program does not link, which is what a refusal is
            // supposed to look like. It empties this column and leaves the row.
            Err(_) if matches!(variant.generated, Generated::Llvm) => results.push(None),
            Err(error) => return Err(error),
        }
    }

    let harness = case.join("bench.mjs");
    let node = measure(std::process::Command::new("node").arg(&harness))?;
    // The same source on the other engine. Bun runs `.ts` natively too, so it
    // imports the identical file rather than a copy that could drift.
    let bun = bun_binary()
        .map(|binary| measure(std::process::Command::new(binary).arg(&harness)))
        .transpose()?;

    agreed(&results, bun.as_ref(), &node)?;

    let required = |at: usize| -> Result<f64> {
        Ok(results
            .get(at)
            .and_then(Option::as_ref)
            .context("a variant that must run did not")?
            .ns_per_op)
    };
    let row = Row {
        case: shown,
        cpp: results
            .get(2)
            .and_then(Option::as_ref)
            .map(|it| it.ns_per_op),
        nts: required(0)?,
        unspecialized: required(1)?,
        node: node.ns_per_op,
        llvm: results
            .get(3)
            .and_then(Option::as_ref)
            .map(|it| it.ns_per_op),
        bun: bun.map(|result| result.ns_per_op),
    };
    println!(
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>9} {:>9} {:>9}",
        row.case,
        row.cpp.map_or_else(|| "--".to_owned(), human),
        human(row.nts),
        row.llvm.map_or_else(|| "--".to_owned(), human),
        human(row.unspecialized),
        human(row.node),
        row.bun.map_or_else(|| "--".to_owned(), human),
        row.against(row.cpp),
        row.against(Some(row.node)),
        row.against(row.bun),
    );
    Ok(row)
}

/// Every variant must agree about the answer before any of them is allowed to
/// be fast.
///
/// Both backends are in here, so this is where a disagreement between them
/// surfaces -- and it did: the LLVM backend answered 1.3186118021857029e-314
/// where node answered 2668900000, which is that number's bit pattern read as a
/// double. A benchmark that did not compare answers would have reported it as a
/// speedup.
fn agreed(results: &[Option<Measured>], bun: Option<&Measured>, node: &Measured) -> Result<()> {
    for (label, checksum) in VARIANTS
        .iter()
        .map(|variant| variant.label)
        .zip(results.iter())
        .filter_map(|(label, result)| result.as_ref().map(|it| (label, it.checksum.as_str())))
        .chain(bun.map(|result| ("bun", result.checksum.as_str())))
    {
        if checksum != node.checksum {
            bail!(
                "{label} computed {checksum} but node computed {} — the benchmark \
                 is measuring two different programs",
                node.checksum
            );
        }
    }
    Ok(())
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
    llvm: bool,
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

    if llvm {
        let emitted = nts_codegen_llvm::emit(&prepared.program);
        // Silent by default: the second backend refuses whole categories of
        // program and says so once per function, and twenty cases' worth of
        // that would bury the table printed above it. `NTS_DECLINES=1` asks,
        // because a refusal nothing prints is how a *regression* looks exactly
        // like a feature that was never built.
        if std::env::var_os("NTS_DECLINES").is_some() {
            for diagnostic in &emitted.diagnostics {
                eprintln!("  declined: {} {}", diagnostic.code, diagnostic.message);
            }
        }
        return Ok(emitted.text);
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
    // Three languages now, not two. A `.ll` is handed to the same clang with
    // `-x ir`, because the file extension is not what clang reads: without it
    // the driver would take a textual module for C and fail on its first line.
    // `-w` because `-Werror` is for source we wrote by hand -- a module the
    // backend rendered has no warnings to fix, and clang emits one about the
    // target triple for every `-x ir` input.
    let (ll, c): (Vec<_>, Vec<_>) = c.iter().cloned().partition(|s| s.extension() == Some("ll"));
    for (driver, extra, sources) in [
        ("clang++", vec!["-std=c++20"], cpp.to_vec()),
        ("clang", vec!["-std=c11"], c),
        ("clang", vec!["-x", "ir", "-w"], ll),
    ] {
        for source in &sources {
            let object = binary.with_extension(format!(
                "{}.o",
                source.file_name().unwrap_or("unit").replace('.', "_")
            ));
            let output = std::process::Command::new(driver)
                .args(SHARED)
                .args(&extra)
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

/// How many processes each variant is run in, best taken.
///
/// A best-of-five *inside* one process is not enough for a JIT. Measured over
/// five processes, node spread 18% and bun 26% on the same case -- and a single
/// low outlier from bun was enough to make it look 18% faster than nts on a
/// benchmark where the two are level. Native code varies far less, but it is
/// measured the same way so that no column gets an advantage the others do not.
///
/// Nearly free: compiling a case costs seconds and running it costs
/// milliseconds, so the extra passes are lost in the build.
const RUNS: usize = 3;

fn measure(command: &mut std::process::Command) -> Result<Measured> {
    let mut best: Option<Measured> = None;
    for _ in 0..RUNS {
        let attempt = measure_once(command)?;
        if best
            .as_ref()
            .is_none_or(|held| attempt.ns_per_op < held.ns_per_op)
        {
            best = Some(attempt);
        }
    }
    best.context("a benchmark produced no measurement")
}

fn measure_once(command: &mut std::process::Command) -> Result<Measured> {
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
