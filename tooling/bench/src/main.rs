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
    /// Class files, run by `java`. Not a C++ file linked against a generated
    /// object: a different artifact *and* a different runner, which is the same
    /// split `run_native`/`run_jvm` already made in the differential.
    Jvm,
    /// Are We Fast Yet's **own** Java, run under the same harness.
    ///
    /// The reference every other column lacks: an implementation in the target
    /// language, so the ratio against it is about this compiler's codegen and
    /// not about the runtime underneath it. A C++ reference cannot say that --
    /// `nts (jvm)` against `C++` mixes a codegen difference with a
    /// HotSpot-versus-clang difference and cannot separate them.
    ///
    /// Theirs rather than one written here, deliberately. A reference the
    /// author of the thing being measured also wrote is not a reference. The
    /// cost of that choice is stated rather than hidden: AWFY's Java is
    /// constrained to the suite's cross-language core, so `benchmark()` returns
    /// `Object` and boxes its result once per call -- against a body that is
    /// hundreds of operations, which is why this is a footnote and not a
    /// correction.
    ///
    /// Only the `awfy-*` cases have one, and every other case leaves the cell
    /// blank on the same bargain the LLVM column keeps.
    JavaReference,
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
    Variant {
        label: "nts (jvm)",
        source: "nts.cpp",
        generated: Generated::Jvm,
    },
    Variant {
        label: "Java",
        source: "nts.cpp",
        generated: Generated::JavaReference,
    },
];

/// Which of Are We Fast Yet's Java classes a case is a port of, and how many
/// inner iterations to ask it for.
///
/// Written out rather than derived from the case name, because `awfy-nbody` is
/// `NBody` and a capitalisation rule that works for seven and not the eighth is
/// worse than a list of eight.
///
/// `None` means "whatever the case's own workload passes", which is right when
/// both ports hold the problem size in the same place. `nbody` is the exception
/// and the reason the third column exists: **Are We Fast Yet's ports do not
/// agree about where the size lives.** Theirs takes 250,000 advances as
/// `innerBenchmarkLoop`'s argument; ours keeps it as a constant inside the
/// benchmark and passes 1, the way every other case here holds its size, and
/// `ref.cpp` passes 250000 to match theirs.
///
/// Passing our 1 to their Java ran **one** advance and reported 59.5ns against
/// 7.36ms for the same work in C++ -- and the cross-variant checksum check
/// passed, because their `verifyResult` carries an explicit
/// `innerIterations == 1` branch that returns true. A guard that was satisfied
/// by a special case in somebody else's code, which is the same failure as a
/// gate assertion satisfied by node being unable to parse a file.
const JAVA_REFERENCES: &[(&str, &str, Option<f64>)] = &[
    ("awfy-bounce", "Bounce", None),
    ("awfy-list", "List", None),
    ("awfy-mandelbrot", "Mandelbrot", None),
    ("awfy-nbody", "NBody", Some(250_000.0)),
    ("awfy-permute", "Permute", None),
    ("awfy-queens", "Queens", None),
    ("awfy-sieve", "Sieve", None),
    ("awfy-towers", "Towers", None),
];

/// Cases where the two hand-written references legitimately differ by more than
/// the guard below tolerates, each with the reason it is real.
///
/// The guard exists because a reference running the wrong iteration count is
/// invisible to the checksum, and it is right about numeric kernels: Java beats
/// C++ on rows here and cannot beat it by an order of magnitude. But a *language
/// level* difference in the cost of one operation is not a mistake, and refusing
/// to print it would make a real 150x gap look exactly like a broken reference
/// -- which is the thing this repository refuses to let happen to a refusal and
/// an absence, and the same argument applies here.
///
/// So the escape is per case and carries its reason in the table rather than in
/// a threshold. Adding a row is a claim that the gap was investigated.
const WIDE_REFERENCE_GAPS: &[(&str, &str)] = &[(
    "exceptions",
    "`new RuntimeException` calls `fillInStackTrace`, which walks the stack and \
     allocates a `StackTraceElement[]`, 12,500 times per operation. C++ pays \
     nothing to construct a thrown value. The two references do the same work \
     and the operation itself costs two orders of magnitude more in one of \
     them, which is what this row exists to report.",
)];

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
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>9} {:>9} {:>9} {:>9}",
        "case",
        "C++",
        "nts C",
        "nts LLVM",
        "nts JVM",
        "Java",
        "nts f64",
        "node",
        "bun",
        "nts/C++",
        "nts/node",
        "nts/bun",
        "jvm/Java"
    );
    println!("{}", "-".repeat(158));

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
/// What a reader has to know before the numbers mean anything.
///
/// Split from [`write_readme`] because the two are different kinds of thing:
/// one is the measurements, the other is the argument that they are
/// measurements of what the heading says.
fn legend(root: &Utf8Path) -> String {
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
        `nts (JVM)` is the same TypeScript compiled to class files and run by \
        `java`. **`refused` is not `--`**: every case is attempted on every \
        backend, so a missing JVM number is always a construct the lane \
        declines by name, and a blank would be indistinguishable from the \
        `Java` column's blank, which means nobody wrote a reference.\n\n\
        `Java` is Are We Fast Yet's **own** hand-written Java for the same \
        benchmark, on the same JVM in the same run — the only reference here \
        written in the language the column beside it compiles to, which is what \
        makes `nts (JVM)/Java` a statement about codegen with the runtime \
        divided out. Every other ratio in this table mixes a codegen \
        difference with an engine difference and cannot separate them. It is \
        `--` for every case that is not a port of one of theirs, which is all \
        but the `awfy-*` rows: writing a second implementation of `substrings` \
        or `bytes` in Java to have something to divide by would be a \
        correctness burden rather than a reference, which is the same reason \
        the `C++` column has the gaps it does.\n\n\
        **The JVM column excludes startup, deliberately and at this lane's own \
        cost.** It is timed inside its own process after the same 20,000 warmup \
        iterations bounded by 300 ms that `V8` and `Bun` get, then calibrated, \
        then best-of-five. A JIT's first iterations measure the compiler rather \
        than the code, so including them would report how long HotSpot took to \
        decide, not what it decided. The honest consequence is that **cold \
        start is absent from this table and is the one number where this lane \
        loses by two orders of magnitude** — it belongs in a column of its own \
        rather than smuggled into these.\n\n\
        `V8` is node and `Bun` is JavaScriptCore, both running the *same* \
        TypeScript source the compiler consumes — the harness imports the `.ts` \
        directly, so there is no second copy of the program to drift. Both are \
        timed inside their own process after 20,000 warmup iterations, so \
        neither startup nor a cold JIT is in either column, and both must \
        produce the same checksum as everything else. Bun is skipped where it \
        is not installed.\n";

    // The commit the numbers are a function of. Benchmarks run from a worktree
    // pinned to a hash precisely so that they are quotable later; a table that
    // did not say which hash would be a measurement of a tree nobody can check
    // out, which is the failure the pinned gate exists to catch one floor up.
    let commit = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map_or_else(
            || "an unknown commit".to_owned(),
            |out| String::from_utf8_lossy(&out.stdout).trim().to_owned(),
        );
    let legend = format!(
        "{legend}\nMeasured at `{commit}`, one case at a time, on cores pinned away from \
         the other sessions sharing this checkout, with the benchmark lock held so nothing \
         else was running.\n"
    );

    legend
}

fn write_readme(root: &Utf8Path, rows: &[Row]) -> Result<()> {
    // Split out for the length limit, and because the two are different kinds
    // of thing: one is the numbers, the other is what a reader has to know
    // before the numbers mean anything.
    const START: &str = "<!-- benchmarks:start -->";
    const END: &str = "<!-- benchmarks:end -->";

    let mut table = String::new();
    let with_bun = rows.iter().any(|row| row.bun.is_some());
    // `nts f64` is measured on every run and printed by the tool; it is not
    // published. It answers "what does the analysis buy", which is a question
    // about this compiler's insides rather than about how fast the thing is,
    // and a reader comparing against V8 does not need a column for it.
    table.push_str(if with_bun {
        "| case | C++ | nts (C) | nts (LLVM) | nts (JVM) | Java | V8 | Bun | nts/C++ | nts/V8 | nts/Bun | nts (JVM)/Java |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    } else {
        "| case | C++ | nts (C) | nts (LLVM) | nts (JVM) | Java | V8 | nts/C++ | nts/V8 | nts (JVM)/Java |\n\
         | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
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
        let jvm = jvm_cell(row.jvm, row.jvm_absence);
        let _ = writeln!(
            table,
            "| {} | {} | {} | **{}** | {jvm} | {} | {} |{bun} {} | {} |{against_bun} {} |",
            row.case,
            row.cpp.map_or_else(|| "--".to_owned(), human),
            human(row.nts),
            row.llvm.map_or_else(|| "--".to_owned(), human),
            row.java.map_or_else(|| "--".to_owned(), human),
            human(row.node),
            row.against(row.cpp),
            row.against(Some(row.node)),
            row.jvm_against_java(),
        );
    }

    let legend = legend(root);
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
    /// The same program as class files, run by `java`. `None` where the JVM
    /// backend refused it, which is most of them today.
    ///
    /// **Not comparable to the native columns without saying so.** A JVM and a
    /// JS engine are both warm JITs and this number excludes startup entirely,
    /// where the native ones have none to exclude. The ratio worth taking here
    /// is against hand-written Java, which is a column this table does not have
    /// -- which it now does, as `Java`.
    jvm: Option<f64>,
    /// Why [`Self::jvm`] is empty, where it is.
    jvm_absence: Option<JvmAbsence>,
    /// Are We Fast Yet's **own** hand-written Java for the same benchmark, on
    /// the same JVM in the same run.
    ///
    /// The only reference in this table written in the language the column
    /// being measured compiles to, which is what makes `jvm/Java` a statement
    /// about codegen with the runtime divided out. Every other ratio here mixes
    /// a codegen difference with an engine difference and cannot separate them.
    ///
    /// `None` for every case that is not a port of one of theirs, which is all
    /// but the `awfy-*` rows.
    java: Option<f64>,
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

    /// The JVM lane against hand-written Java, which is the one ratio in this
    /// table with the runtime divided out.
    ///
    /// Deliberately not `against`: that one divides the *primary* column, which
    /// is the C backend, and dividing a native binary by a JVM number would be
    /// a ratio about `HotSpot` rather than about anything this compiler decided.
    fn jvm_against_java(&self) -> String {
        match (self.jvm, self.java) {
            (Some(ours), Some(theirs)) => format!("{ours_over:.2}x", ours_over = ours / theirs),
            _ => "--".to_owned(),
        }
    }
}

/// The prefix `jvm_case` bails with when the *backend* is the reason, which is
/// what tells it apart from every other way that function can fail.
const DECLINED: &str = "the JVM backend declined ";

/// Why the JVM column has no number for a row.
///
/// The distinction is the whole point of the column being honest. A construct
/// this backend refuses is a fact about this compiler; a program the harness
/// cannot *call* is a fact about the harness, and `elementwise` and
/// `optional-chain` compile to class files perfectly well -- their entry points
/// take an array, and the generated driver declares every argument a
/// `volatile double`, so `javac` rejects the driver rather than the program.
///
/// Reporting the second as `refused` was wrong for exactly one afternoon, and
/// it read as eight missing features where there are six deliberate refusals
/// and two harness gaps.
#[derive(Debug, Clone, Copy)]
enum JvmAbsence {
    /// The backend declined a construct, by name, at emit time.
    Refused,
    /// The backend emitted it and the harness has no way to drive it.
    NoDriver,
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

    let (results, jvm_absence) = variants(root, case, out, name, &tsconfig, &entry, provider, defines,
        &specialized, &plain, &rendered, renderable, needs_unicode)?;
    finish_row(case, &shown, &results, jvm_absence)
}

/// Every variant of one case, built and measured in the order `VARIANTS` gives.
#[allow(
    clippy::too_many_arguments,
    reason = "the paths a case builds from are computed once by its caller; \
              bundling them into a struct would name a thing that exists for \
              the length of one call"
)]
fn variants(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    tsconfig: &Utf8Path,
    entry: &[String],
    provider: hir::Provider,
    defines: &[&str],
    specialized: &Utf8Path,
    plain: &Utf8Path,
    rendered: &Utf8Path,
    renderable: bool,
    needs_unicode: bool,
) -> Result<(Vec<Option<Measured>>, Option<JvmAbsence>)> {
    let mut results: Vec<Option<Measured>> = Vec::new();
    // Why the JVM column is empty, where it is. Two different absences that a
    // single blank -- or a single `refused` -- would flatten into one.
    let mut jvm_absence: Option<JvmAbsence> = None;
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
            // Not a C++ file linked against a generated object, so it leaves
            // this loop rather than joining the command line below. A refused
            // program has no classes, which empties the column and leaves the
            // row -- the same bargain the LLVM column keeps.
            Generated::Jvm => {
                match jvm_case(root, case, out, name, tsconfig, entry, provider) {
                    Ok(measured) => results.push(Some(measured)),
                    Err(error) => {
                        // The backend declining a construct and the harness
                        // being unable to *call* the program are different
                        // facts, and only the first is about this compiler.
                        jvm_absence = Some(if error.to_string().starts_with(DECLINED) {
                            JvmAbsence::Refused
                        } else {
                            JvmAbsence::NoDriver
                        });
                        results.push(None);
                    }
                }
                continue;
            }
            Generated::JavaReference => {
                results.push(java_reference(root, case, out, name).ok().flatten());
                continue;
            }
            Generated::Specialized => c.push(specialized.to_owned()),
            Generated::Unspecialized => c.push(plain.to_owned()),
            Generated::Llvm if renderable => c.push(rendered.to_owned()),
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
    Ok((results, jvm_absence))
}

/// The engines, the checksum agreement, and the printed row.
///
/// Split from [`variants`] because they answer different questions: one builds
/// this compiler's output, the other asks what everybody else got and whether
/// the answers match.
fn finish_row(
    case: &Utf8Path,
    shown: &str,
    results: &[Option<Measured>],
    jvm_absence: Option<JvmAbsence>,
) -> Result<Row> {
    let harness = case.join("bench.mjs");
    let node = measure(std::process::Command::new("node").arg(&harness))?;
    // The same source on the other engine. Bun runs `.ts` natively too, so it
    // imports the identical file rather than a copy that could drift.
    let bun = bun_binary()
        .map(|binary| measure(std::process::Command::new(binary).arg(&harness)))
        .transpose()?;

    agreed(results, bun.as_ref(), &node)?;

    let required = |at: usize| -> Result<f64> {
        Ok(results
            .get(at)
            .and_then(Option::as_ref)
            .context("a variant that must run did not")?
            .ns_per_op)
    };
    let row = Row {
        case: shown.to_owned(),
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
        jvm: results
            .get(4)
            .and_then(Option::as_ref)
            .map(|it| it.ns_per_op),
        jvm_absence,
        java: results
            .get(5)
            .and_then(Option::as_ref)
            .map(|it| it.ns_per_op),
        bun: bun.map(|result| result.ns_per_op),
    };
    // A reference and a subject that disagree about how much work to do are not
    // comparable, and the checksum cannot say so: every AWFY case answers 1 or
    // 0, and `nbody`'s `verifyResult` returns *true* for one iteration as
    // happily as for 250,000. So the guard is on the magnitude, against the
    // other hand-written reference for the same program.
    //
    // Twenty times is far outside any codegen difference. Java can beat C++ on
    // a row and does; it cannot beat it by an order of magnitude on a numeric
    // kernel, so a gap that size means one of them is doing different work.
    if let (Some(cpp), Some(java)) = (row.cpp, row.java)
        && (java * 20.0 < cpp || cpp * 20.0 < java)
    {
        if let Some((_, why)) = WIDE_REFERENCE_GAPS
            .iter()
            .find(|(which, _)| *which == row.case)
        {
            eprintln!(
                "note: {} -- Java {} against C++ {} -- {}",
                row.case,
                human(java),
                human(cpp),
                why
            );
        } else {
            bail!(
                "the Java reference for {} ran in {} against {} for the C++ \
                 reference -- that is not a codegen difference, it is the two \
                 references doing different amounts of work. Check the \
                 iteration count in JAVA_REFERENCES.",
                row.case,
                human(java),
                human(cpp)
            );
        }
    }
    println!(
        "{:<16} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11} {:>11}   {:>9} {:>9} {:>9} {:>9}",
        row.case,
        row.cpp.map_or_else(|| "--".to_owned(), human),
        human(row.nts),
        row.llvm.map_or_else(|| "--".to_owned(), human),
        jvm_cell(row.jvm, row.jvm_absence),
        row.java.map_or_else(|| "--".to_owned(), human),
        human(row.unspecialized),
        human(row.node),
        row.bun.map_or_else(|| "--".to_owned(), human),
        row.against(row.cpp),
        row.against(Some(row.node)),
        row.against(row.bun),
        row.jvm_against_java(),
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
/// What `bench_run` actually calls, read out of the one place it is written.
///
/// # Why this is parsed rather than declared again
///
/// Every case states its workload once, in `nts.cpp`: a `volatile` input at the
/// call site and one call taking it. A hand-written `Case.java` beside it would
/// be a second statement of the same thing, free to drift -- and a JVM column
/// measuring a different workload than the C column would be a ratio about the
/// harnesses. So the JVM lane reads the C shim rather than duplicating it, and
/// the workload is the same by construction instead of by inspection.
///
/// The parse is narrow on purpose. Thirty-nine cases share one shape, and a
/// case that does not match is refused rather than guessed at.
/// The `nts (JVM)` cell, which says *which kind* of missing it is.
///
/// `refused` is a construct this lane declines by name and is the compiler's;
/// `no driver` is this harness being unable to *call* the program and is not.
/// Only the first is a gap in the backend.
///
/// One function because the console and the README are two renderings of one
/// table, and they had drifted: the README distinguished the two states and the
/// console printed `--` for both. Three blanks in that column once turned out to
/// be a refusal, a harness limit, and a `NullPointerException`, and the one that
/// was a bug looked exactly like the two that were not -- so the triage started
/// from the rendering that had thrown the distinction away.
fn jvm_cell(time: Option<f64>, absence: Option<JvmAbsence>) -> String {
    match (time, absence) {
        (Some(time), _) => human(time),
        (None, Some(JvmAbsence::NoDriver)) => "no driver".to_owned(),
        (None, _) => "refused".to_owned(),
    }
}

fn workload(case: &Utf8Path) -> Result<(String, Vec<String>)> {
    let source = std::fs::read_to_string(case.join("nts.cpp"))
        .with_context(|| format!("reading {case}/nts.cpp"))?;
    let body = source
        .split_once("double bench_run(void) {")
        .context("no `bench_run` to read a workload from")?
        .1;
    let mut inputs: Vec<(String, String)> = Vec::new();
    for line in body.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("volatile ")
            && let Some((declaration, value)) = rest.split_once('=')
            && let Some(name) = declaration.split_whitespace().last()
        {
            inputs.push((name.to_owned(), value.trim_end_matches(';').trim().to_owned()));
        }
        if let Some(call) = line.strip_prefix("return ")
            && let Some(open) = call.find('(')
        {
            let callee = call[..open].trim().to_owned();
            let arguments = call[open + 1..]
                .rsplit_once(')')
                .context("an unterminated call in `bench_run`")?
                .0;
            let mut resolved = Vec::new();
            for argument in arguments.split(',').map(str::trim).filter(|a| !a.is_empty()) {
                let value = inputs
                    .iter()
                    .find(|(name, _)| name == argument)
                    .map(|(_, value)| value.clone())
                    .with_context(|| format!("`{argument}` is not a `volatile` input"))?;
                resolved.push(value);
            }
            return Ok((callee, resolved));
        }
    }
    bail!("{case}/nts.cpp has no `return <call>` in `bench_run`")
}

/// One case through the JVM backend: classes, the runtime jar, a generated
/// driver, and `java`.
fn jvm_case(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    tsconfig: &Utf8Path,
    entry: &[String],
    provider: hir::Provider,
) -> Result<Measured> {
    use std::fmt::Write as _;

    // A case declares `rc` because the *native* lane needs it: `NoGc` never
    // frees, so a run calibrated to a hundred milliseconds of work would
    // measure page faults rather than code. This lane has a tracing collector
    // underneath it and needs no such declaration -- and must not receive one,
    // because a `Retain` reaching a host-collected object is RFC 13's second
    // GC inside ART, which this backend refuses by name.
    //
    // Inheriting it meant six cases -- `map-and-set`, `pipeline`,
    // `case-convert`, `node-utf8`, `array-mutations`, `array-predicates` --
    // reported `refused` and were never timed here at all. That is not a
    // missing feature; it is the harness asking for a configuration this lane
    // is defined not to have, and then recording the refusal as the
    // compiler's. `NtsMap` had no timing on this backend for that reason.
    //
    // `NoGc` here is not the native lane's `NoGc`. There, it means nothing is
    // ever freed. Here, the platform frees, so it means *this compiler emits
    // no reclamation of its own* -- which is the shipping configuration for
    // this backend rather than a concession for a benchmark.
    let provider = match provider {
        hir::Provider::ReferenceCounting | hir::Provider::NoGc => hir::Provider::NoGc,
    };

    let supplied = case.join("driver.java");
    let workload = if supplied.exists() { None } else { Some(workload(case)?) };
    let program = prepared_program(tsconfig, entry, true, provider)?;
    let emitted = nts_codegen_jvm::emit(&program);
    if !emitted.is_complete() {
        bail!("{DECLINED}{} function(s)", emitted.diagnostics.len());
    }
    let dir = out.join(format!("{name}.jvm"));
    std::fs::create_dir_all(&dir)?;
    for class in &emitted.classes {
        let path = dir.join(class.path());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &class.bytes)?;
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref())?;

    // A case whose workload cannot be recovered from `nts.cpp` writes its own
    // driver instead.
    //
    // `workload` reads `bench_run` and requires every argument to be a
    // `volatile` scalar, which is true of every case but the ones that pass an
    // array: `elementwise` hands the same buffer to each call and refills it, so
    // there is no expression to synthesise and the state has to be reset between
    // runs or the contents compound and the checksum depends on how many times
    // the harness happened to call it.
    //
    // Verbatim rather than templated. A driver is twenty lines of Java that
    // belongs next to the case it drives, and inventing a substitution language
    // for the two cases that need one would be the larger mistake.
    let Some((callee, arguments)) = workload else {
        let text = std::fs::read_to_string(&supplied)
            .with_context(|| format!("reading {supplied}"))?;
        let driver_path = dir.join("Case.java");
        std::fs::write(&driver_path, text)?;
        return run_driver(root, &dir, &jar, &driver_path);
    };
    // The driver, from the workload the C shim already declares. Every input is
    // a `volatile` field for the reason the C shim makes them `volatile`: a
    // loop-invariant argument lets the JIT hoist the whole call out of the timed
    // loop and report an impressive zero.
    let mut driver = String::from("public final class Case {\n");
    let mut passed = Vec::new();
    for (at, value) in arguments.iter().enumerate() {
        let _ = writeln!(driver, "    private static volatile double in{at} = {value};");
        passed.push(format!("in{at}"));
    }
    let _ = writeln!(driver, "    public static void main(String[] argv) {{");
    let _ = writeln!(driver, "        Bench.measure(new Bench.Work() {{");
    let _ = writeln!(driver, "            @Override public double run() {{");
    let _ = writeln!(
        driver,
        "                return nts.gen.Program.{}({});",
        nts_codegen_jvm::body::method_name(&callee),
        passed.join(", ")
    );
    let _ = writeln!(driver, "            }}\n        }});\n    }}\n}}");
    let driver_path = dir.join("Case.java");
    std::fs::write(&driver_path, driver)?;

    run_driver(root, &dir, &jar, &driver_path)
}

/// Compile a driver against the emitted classes and time it.
///
/// Shared by the generated driver and a case's own, so the two cannot drift
/// apart on the flags -- which would make one row's number mean something
/// slightly different from the rest of the column.
fn run_driver(
    root: &Utf8Path,
    dir: &Utf8Path,
    jar: &Utf8Path,
    driver_path: &Utf8Path,
) -> Result<Measured> {
    let javac = java_tool("javac");
    let built = std::process::Command::new(javac)
        .arg("-cp")
        .arg(dir)
        .arg("-d")
        .arg(dir)
        .arg(root.join("benches/common/Bench.java"))
        .arg(driver_path)
        .output()
        .context("running javac")?;
    if !built.status.success() {
        bail!("javac: {}", String::from_utf8_lossy(&built.stderr));
    }

    let java = java_tool("java");
    measure(
        std::process::Command::new(java)
            // Explicit rather than ergonomic: the default collector changes with
            // the host, and a column that changes meaning with the machine is
            // not an instrument. Equal bounds so no resizing happens mid-run.
            .args(["-XX:+UseG1GC", "-Xms512m", "-Xmx512m", "-XX:-UsePerfData"])
            .arg("-cp")
            .arg(format!("{dir}:{jar}"))
            .arg("Case"),
    )
}

/// Are We Fast Yet's own Java, built and measured under the same harness.
///
/// `Ok(None)` for a case with no counterpart, which is every case that is not a
/// port of one of theirs -- a blank cell rather than a failed row.
///
/// The driver mirrors `benches/cases/awfy-*/src/main.ts` exactly: construct the
/// benchmark, call `innerBenchmarkLoop`, return 1 or 0. That is their driver
/// unchanged, and it is what makes the checksum comparable across every column
/// -- a variant that were fast because it computed something else would fail
/// the runner's cross-variant check rather than win.
/// Measure a `ref.java` sitting beside the case.
///
/// The contract mirrors `ref.cpp`'s exactly: the file declares
/// `public final class Ref` with a `public static double benchRun()` that is
/// self-contained -- it declares its own inputs, `volatile` for the reason the
/// C++ one does, so a loop-invariant argument cannot let the JIT hoist the
/// whole call out of the timed loop.
///
/// Compiled with `-nowarn` and run under the same flags and the same warmup as
/// every other JVM column, because a reference measured differently from the
/// thing it is a reference for is not one.
fn handwritten_java(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
) -> Result<Measured> {
    use std::fmt::Write as _;

    let dir = out.join(format!("{name}.javaref"));
    std::fs::create_dir_all(&dir)?;
    let mut driver = String::from("public final class Case {\n");
    let _ = writeln!(driver, "    public static void main(String[] argv) {{");
    let _ = writeln!(driver, "        Bench.measure(new Bench.Work() {{");
    let _ = writeln!(driver, "            @Override public double run() {{");
    let _ = writeln!(driver, "                return Ref.benchRun();");
    let _ = writeln!(driver, "            }}\n        }});\n    }}\n}}");
    let driver_path = dir.join("Case.java");
    std::fs::write(&driver_path, driver)?;

    let compiled = std::process::Command::new(java_tool("javac"))
        .arg("-nowarn")
        .arg("-d")
        .arg(dir.as_str())
        .arg(case.join("ref.java").as_str())
        .arg(root.join("benches/common/Bench.java").as_str())
        .arg(driver_path.as_str())
        .output()
        .context("running javac over a hand-written Java reference")?;
    if !compiled.status.success() {
        bail!("javac: {}", String::from_utf8_lossy(&compiled.stderr));
    }

    measure(
        std::process::Command::new(java_tool("java"))
            .args(["-XX:+UseG1GC", "-Xms512m", "-Xmx512m", "-XX:-UsePerfData"])
            .arg("-cp")
            .arg(dir.as_str())
            .arg("Case"),
    )
}

fn java_reference(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
) -> Result<Option<Measured>> {
    use std::fmt::Write as _;

    // A hand-written Java implementation beside the case, which is the Java
    // analogue of `ref.cpp` and takes precedence over the Are We Fast Yet
    // lookup below.
    //
    // Without this the `Java` column could only exist for the eight cases that
    // are ports of somebody else's suite, and the one ratio in this table that
    // divides the runtime out -- our JVM output against a person's Java, on the
    // same JVM in the same run -- was unavailable for every case this project
    // wrote itself. `generator` is the first: a 3.2x against the LLVM backend
    // says nothing about codegen, because it compares a JIT to a native binary.
    if case.join("ref.java").exists() {
        return handwritten_java(root, case, out, name).map(Some);
    }

    let Some((_, class, override_iterations)) =
        JAVA_REFERENCES.iter().find(|(which, _, _)| *which == name)
    else {
        return Ok(None);
    };
    let sources = root.join("third_party/are-we-fast-yet/benchmarks/Java/src");
    if !sources.exists() {
        // The suite is cloned, not vendored, exactly as the C++ column's is.
        return Ok(None);
    }

    // One build of their tree for every case, since it is the same tree. Keyed
    // on a marker file rather than on the directory existing, so a build that
    // died halfway is rebuilt rather than reused.
    let built = out.join("awfy-java");
    if !built.join(".complete").exists() {
        std::fs::create_dir_all(&built)?;
        let mut listing = Vec::new();
        collect_java(&sources, &mut listing)?;
        let compiled = std::process::Command::new(java_tool("javac"))
            .arg("-nowarn")
            .arg("-d")
            .arg(built.as_str())
            .args(listing.iter().map(|path| path.as_str()))
            .output()
            .context("running javac over the Are We Fast Yet Java sources")?;
        if !compiled.status.success() {
            bail!("javac: {}", String::from_utf8_lossy(&compiled.stderr));
        }
        std::fs::write(built.join(".complete"), b"")?;
    }

    let (_, arguments) = workload(case)?;
    let iterations = match override_iterations {
        Some(count) => count.to_string(),
        None => arguments
            .first()
            .cloned()
            .with_context(|| format!("{name} has no workload argument"))?,
    };

    let dir = out.join(format!("{name}.javaref"));
    std::fs::create_dir_all(&dir)?;
    let mut driver = String::from("public final class Case {\n");
    // `volatile` for the reason the generated driver's inputs are: a
    // loop-invariant argument lets the JIT hoist the whole call out of the
    // timed loop and report an impressive zero.
    let _ = writeln!(driver, "    private static volatile double in0 = {iterations};");
    let _ = writeln!(driver, "    public static void main(String[] argv) {{");
    let _ = writeln!(driver, "        Bench.measure(new Bench.Work() {{");
    let _ = writeln!(driver, "            @Override public double run() {{");
    let _ = writeln!(
        driver,
        "                return new {class}().innerBenchmarkLoop((int) in0) ? 1 : 0;"
    );
    let _ = writeln!(driver, "            }}\n        }});\n    }}\n}}");
    let driver_path = dir.join("Case.java");
    std::fs::write(&driver_path, driver)?;

    let compiled = std::process::Command::new(java_tool("javac"))
        .arg("-nowarn")
        .arg("-cp")
        .arg(built.as_str())
        .arg("-d")
        .arg(dir.as_str())
        .arg(root.join("benches/common/Bench.java").as_str())
        .arg(driver_path.as_str())
        .output()
        .context("running javac on the reference driver")?;
    if !compiled.status.success() {
        bail!("javac: {}", String::from_utf8_lossy(&compiled.stderr));
    }

    measure(
        std::process::Command::new(java_tool("java"))
            .args(["-XX:+UseG1GC", "-Xms512m", "-Xmx512m", "-XX:-UsePerfData"])
            .arg("-cp")
            .arg(format!("{dir}:{built}"))
            .arg("Case"),
    )
    .map(Some)
}

/// Every `.java` under a directory, recursively.
fn collect_java(dir: &Utf8Path, into: &mut Vec<Utf8PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = Utf8PathBuf::from_path_buf(entry?.path())
            .map_err(|path| anyhow::anyhow!("{} is not utf-8", path.display()))?;
        if path.is_dir() {
            collect_java(&path, into)?;
        } else if path.extension() == Some("java") {
            into.push(path);
        }
    }
    Ok(())
}

/// `JAVA_HOME` if it has the tool, else the bare name for `PATH` to resolve.
///
/// Infallible: a JDK that is absent is reported by the `Command` that fails to
/// start, with the name in it, which is a better message than anything this
/// could construct.
fn java_tool(name: &str) -> Utf8PathBuf {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = Utf8PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return path;
        }
    }
    Utf8PathBuf::from(name)
}

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
    let program = prepared_program(tsconfig, entry, specialize, provider)?;
    if llvm {
        let emitted = nts_codegen_llvm::emit(&program);
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
    let emitted = nts_codegen_c::emit(&program);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  {} {}", diagnostic.code, diagnostic.message);
    }
    Ok(emitted.writer.text().to_owned())
}

/// The middle end, run once and shared by every lane.
///
/// Split out of [`emit`] so the JVM backend gets the same program the C and
/// LLVM columns do -- including the `Roots::Entry` argument the comment below
/// exists to justify, which is the difference between measuring a benchmark and
/// measuring a library.
fn prepared_program(
    tsconfig: &Utf8Path,
    entry: &[String],
    specialize: bool,
    provider: hir::Provider,
) -> Result<hir::Program> {
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
    Ok(prepared.program)
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
