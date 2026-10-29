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
use nts_frontend_ts::Frontend;
use serde::{Deserialize, Serialize};

/// Counting mode: fixed-work `instructions:u` under perf's control FIFO.
mod execution;
mod reference_link;
mod references;
mod results;
mod workload;

/// One measurement.
#[derive(Serialize, Deserialize)]
struct Measured {
    ns_per_op: f64,
    checksum: String,
    /// Slowest pass over fastest, across `RUNS` processes.
    spread: f64,
    /// The JVM driver's warm-up reached its cap with the JIT still compiling,
    /// so this pass may have timed its first tier (`Bench.settle`).
    #[serde(default)]
    warm_capped: bool,
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
        source: "case.ts",
        generated: Generated::Specialized,
    },
    Variant {
        label: "nts f64",
        source: "case.ts",
        generated: Generated::Unspecialized,
    },
    Variant {
        label: "C++",
        source: "ref.cpp",
        generated: Generated::None,
    },
    Variant {
        label: "nts (llvm)",
        source: "case.ts",
        generated: Generated::Llvm,
    },
    Variant {
        label: "nts (jvm)",
        source: "case.ts",
        generated: Generated::Jvm,
    },
    Variant {
        label: "Java",
        source: "ref.java",
        generated: Generated::JavaReference,
    },
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

/// Other compiler processes on this machine, by executable name.
///
/// **`pgrep -x`, never `-f`.** The full-command-line form matches the caller's
/// own command line and the loop sees itself; `tooling/gate/wait-idle.sh` has
/// that trap written out at length and a self-test that runs the claim. This is
/// the same question asked from Rust.
///
/// Our own pid is excluded so a second `nts-bench` is visible and this one is
/// not.
fn other_compilers() -> Vec<u32> {
    let mine = std::process::id();
    let mut found = Vec::new();
    for name in ["nts", "nts-bench"] {
        let Ok(output) = std::process::Command::new("pgrep")
            .arg("-x")
            .arg(name)
            .output()
        else {
            continue;
        };
        found.extend(
            String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .filter_map(|pid| pid.parse::<u32>().ok())
                .filter(|pid| *pid != mine),
        );
    }
    found.sort_unstable();
    found.dedup();
    found
}

/// Whether this run may rewrite the full table (`results/benchmarks/full.md`),
/// and why not when it may not.
///
/// Split out from `main` so the three reasons to decline sit together: a
/// filtered run, a run that lost a case, and a run that was not alone on the
/// machine. Each of them publishes a table describing something other than what
/// the header says, and the first two were already refused here while the third
/// was only noted.
fn publish(
    root: &Utf8Path,
    rows: &[Row],
    cases: &[Utf8PathBuf],
    requested: &[String],
    spoiled: &[String],
    lanes: Option<&[String]>,
) -> Result<()> {
    // A run of some lanes has `--` where the others would be, over every case
    // as readily as over a few, and it wrote those into the table until this.
    if let Some(lanes) = lanes {
        println!(
            "\nfull table not updated: NTS_BENCH_LANES measured only {}.",
            lanes.join(", ")
        );
        return Ok(());
    }
    // Only a full run may rewrite the full table. A filtered one would leave the
    // table describing a mixture of two machines and two revisions, which is
    // worse than a stale table because it does not look stale.
    //
    // A run that noted load is the same mixture and was published anyway. On
    // 2026-09-06 a forty-minute publish had another session's `cargo build`
    // running from `generic-classes` onward -- **twenty-eight of fifty cases
    // carried the note** -- and this wrote the README regardless. The per-case
    // note is the right call for the console, where a person reads it beside
    // the number; it is not a substitute for refusing to publish, because the
    // README carries the number and not the note.
    //
    // What saved that run was the publish being made from a pinned worktree, so
    // the polluted table landed in a tree nobody reads and shipping it needed a
    // deliberate copy. That is luck arranged in advance rather than a check,
    // which is what this is.
    if !spoiled.is_empty() && requested.is_empty() {
        println!(
            "\nfull table not updated: {} of {} cases were measured while something \
             else ran -- {}",
            spoiled.len(),
            cases.len(),
            spoiled.join(", ")
        );
        return Ok(());
    }
    if requested.is_empty()
        && rows.len() == cases.len()
        && let Some(drift) = refusal_drift(rows, REFUSES_TODAY)
    {
        println!("\nfull table not updated: {drift}");
        return Ok(());
    }
    if requested.is_empty() && rows.len() == cases.len() {
        let written = write_full_table(root, rows)?;
        println!("\nwrote {written}");
    } else if !requested.is_empty() {
        println!("\nfull table not updated: a filtered run measures only part of the table.");
    } else {
        println!("\n{}", lost_case_decline(rows, cases));
    }
    Ok(())
}

/// Why a full run declined to publish, when what it lost was a case.
///
/// **The third decline reason, and it used to be the silent one.** `publish`'s
/// comment says the three sit together so a reader meets them in one place; two
/// of them printed and this one returned without a word. A full sweep that lost
/// a case wrote nothing to the README and said nothing about not writing, so it
/// read as a publish that had simply not changed anything -- the only trace a
/// `failed:` line for one case, forty rows above, inside the table the eye takes
/// as the result.
///
/// That cost twenty-eight minutes of watching a finished run on 2026-09-15. The
/// case was `json-stringify-doc`, whose `work` a lowering refusal had dropped
/// since the last publish: `emit-c` printed `NTS1001`, **exited zero**, wrote C
/// with no entry point, and the failure surfaced as `undefined reference to
/// 'work'` from the linker, with nothing connecting it to the refusal five lines
/// above.
///
/// A separate function so it can be asserted rather than watched: the branch it
/// serves is reachable only from a full sweep that loses a case, which is forty
/// minutes to provoke and not something to leave untested on that account.
///
/// Names the cases rather than counting them, because which one it is decides
/// what to do next -- a case that lost its reference and a case this compiler
/// can no longer lower produce the identical line here and nothing else
/// separates them.
fn lost_case_decline(rows: &[Row], cases: &[Utf8PathBuf]) -> String {
    let measured: std::collections::HashSet<&str> = rows
        .iter()
        .map(|row| row.case.strip_suffix(" (rc)").unwrap_or(&row.case))
        .collect();
    let lost: Vec<&str> = cases
        .iter()
        .filter_map(|case| case.file_name())
        .filter(|name| !measured.contains(name))
        .collect();
    format!(
        "full table not updated: {} of {} cases produced no row -- {}. A table \
         missing a row it used to carry is not a smaller table, it is one that \
         answers a different question, so this declines rather than publishing \
         the rest.",
        lost.len(),
        cases.len(),
        if lost.is_empty() {
            "and not one of them could be named, which is a bug in this function".to_owned()
        } else {
            lost.join(", ")
        }
    )
}

/// Refuse to begin, or warn about the row that was measured anyway.
///
/// A benchmark wants a quiet machine and the measurement lock does not give it
/// one: the lock excludes *other sessions*, and the run that spoiled a full
/// publish here was a 159-case `nts check` sweep started from the same session
/// that held it. Both processes were legitimately mine, so no lock protocol
/// could have refused either.
///
/// What can refuse is this: the timed runner asking, at the start and before
/// every case, whether anything else is compiling. `NTS_BENCH_ALONE=0` opts out
/// for a run that knowingly shares.
fn quiet_enough(when: &str) -> Option<String> {
    if std::env::var("NTS_BENCH_ALONE").is_ok_and(|value| value == "0") {
        return None;
    }
    let busy = other_compilers();
    if busy.is_empty() {
        return None;
    }
    // **With its age, which is the difference between a note and an alarm.**
    // Before the native switch, on 2026-09-12 an `emit-jvm` of
    // `tests/programs/library` blocked in `anon_pipe_read` waiting on tsgo -- zero CPU
    // ticks in eleven hours and forty-three minutes -- and this check did its
    // job perfectly: it declined every timed run on the machine for half a day
    // rather than measure against it.
    //
    // That is the failure. A check that refuses correctly makes a hung process
    // **silent** rather than loud, and `wait-idle.sh` waits forever on one that
    // never exits. `another compiler is running (1542606)` reads as "somebody is
    // working"; `another compiler is running (1542606 11h43m)` reads as
    // "something is wrong", and they are one field apart.
    let pids: Vec<String> = busy
        .iter()
        .map(|pid| match age_of(*pid) {
            Some(age) => format!("{pid} {age}"),
            None => pid.to_string(),
        })
        .collect();
    Some(format!(
        "another compiler is running ({}) {when}; a timed run wants the machine \
         to itself -- `tooling/gate/wait-idle.sh`, or `NTS_BENCH_ALONE=0` to \
         measure anyway",
        pids.join(", ")
    ))
}

/// How long a process has been alive, as a person reads it.
///
/// From `/proc`, because `ps` would be a second process to spawn per pid inside
/// a check that runs before every case. `starttime` is field 22 of
/// `/proc/<pid>/stat`, and the fields are counted from after the **last** `)`
/// rather than by splitting the whole line: the command name sits in
/// parentheses and may itself contain spaces and parentheses, which is the
/// documented reason `/proc` parsers go wrong.
fn age_of(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields: Vec<&str> = stat[stat.rfind(')')? + 1..].split_whitespace().collect();
    // Index 0 here is `state`, which is field 3, so field 22 is index 19.
    let started: u64 = fields.get(19)?.parse().ok()?;
    let uptime = std::fs::read_to_string("/proc/uptime").ok()?;
    // Whole seconds on both sides, so there is no float and no cast: `/proc`
    // gives uptime as `12345.67` and `starttime` in clock ticks, and a second
    // of granularity is more than a message measured in hours needs.
    //
    // `_SC_CLK_TCK`, which is 100 on every Linux this runs on. A wrong constant
    // here misreports an age and cannot misreport whether there is one.
    let up: u64 = uptime
        .split_whitespace()
        .next()?
        .split('.')
        .next()?
        .parse()
        .ok()?;
    let seconds = up.saturating_sub(started / 100);
    Some(match seconds {
        s if s >= 3600 => format!("{}h{:02}m", s / 3600, (s % 3600) / 60),
        s if s >= 60 => format!("{}m{:02}s", s / 60, s % 60),
        s => format!("{s}s"),
    })
}

/// The tree this run measures and publishes into.
///
/// `--root` when given, and otherwise the tree this binary was *compiled* in,
/// because `env!("CARGO_MANIFEST_DIR")` is baked in at build time. That default
/// is load-bearing and quietly so: it means a binary built in the main checkout
/// rewrites the main checkout's `results/benchmarks/` even when run from a worktree
/// pinned for the measurement, and the only reason a publish lands in the
/// pinned tree is that whoever ran it also built it there.
///
/// `nts-suite` has the same shape and it is not hypothetical there -- a gate
/// step run from a sealed tree edited the live checkout's outcome table, and
/// three sessions spent an exchange working out whose change it was.
///
/// Kept as the default rather than replaced, because building where you measure
/// is the right discipline and this makes it explicit rather than accidental.
fn repository_root(args: &[String]) -> Result<Utf8PathBuf> {
    if let Some(at) = args.iter().position(|arg| arg == "--root") {
        let given = args.get(at + 1).context("`--root` needs a path after it")?;
        return Utf8PathBuf::from(given)
            .canonicalize_utf8()
            .context("locating the repository root named by `--root`");
    }
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .context("locating the repository root")
}

fn main() -> Result<()> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    validate_lanes()?;
    let root = repository_root(&argv)?;
    if argv
        .iter()
        .any(|arg| arg == "--count" || arg == "--count-prepare")
    {
        bail!("the Wasm backend is being rebuilt on Binaryen; see docs/targets/wasm.md");
    }
    if let Some(at) = argv.iter().position(|arg| arg == "--render") {
        let path = argv
            .get(at + 1)
            .filter(|next| !next.starts_with('-'))
            .map_or_else(|| run_file(&root), Utf8PathBuf::from);
        return render(&root, &path);
    }
    let cases_dir = root.join("benchmarks/cases");

    // A flag's *value* is not a case name. Filtering on the leading dash alone
    // would leave `--root <path>` looking like a request for a case called
    // `<path>`, which matches nothing -- and a run with a non-empty `requested`
    // is a filtered run, so the publish would decline and say it measured only
    // part of the table. Loud rather than wrong, and still not what was asked.
    let mut requested: Vec<String> = Vec::new();
    let mut rest = argv.iter();
    while let Some(arg) = rest.next() {
        if arg == "--root" {
            let _ = rest.next();
        } else if !arg.starts_with('-') {
            requested.push(arg.clone());
        }
    }
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
    if let Some(warning) = quiet_enough("before this run started") {
        bail!("{warning}");
    }

    for file in nts_codegen_c::support_files(true) {
        file.write(out.as_std_path())
            .with_context(|| format!("writing {}", file.name))?;
    }

    println!(
        "case\tC++\tnts C\tnts LLVM\tnts JVM\tJava\tnts f64\tnode\tbun\tnts/C++\tnts/node\tnts/bun\tjvm/Java"
    );

    let lanes = wanted_lanes();
    let mut rows = Vec::new();
    let mut measured = Vec::new();
    let mut spoiled = Vec::new();
    let mut failed = Vec::new();
    for case in &cases {
        // Before each case rather than once at the start: a sweep begun while
        // the suite is halfway through spoils the rows after it and none
        // before, and a note on those rows is worth more than a refusal that
        // throws away forty minutes of correct measurement.
        if let Some(warning) = quiet_enough("while this case was measured") {
            println!("note: {:<16} {warning}", case.file_name().unwrap_or("?"));
            spoiled.push(case.file_name().unwrap_or("?").to_string());
        }
        // A row that fails its checks keeps its measurements: `--render` judges
        // them again, which is the point of saving them.
        let name = case.file_name().unwrap_or("?");
        if let Some(measurements) = accept_result(name, run_case(&root, case, &out), &mut failed) {
            if let Some(row) = accept_result(
                &measurements.shown,
                assemble(&measurements, lanes.is_some()),
                &mut failed,
            ) {
                rows.push(row);
            }
            measured.push(measurements);
        }
    }

    let run = Run {
        lanes: lanes.clone(),
        requested: requested.clone(),
        cases: cases
            .iter()
            .filter_map(|case| case.file_name().map(str::to_owned))
            .collect(),
        spoiled: spoiled.clone(),
        failed,
        measured,
    };
    finish(&root, &run, &rows, &cases)
}

/// Save a run, record what it measured, and rewrite the full table if it may.
///
/// Every run records its cells, whether or not it may rewrite the full table;
/// `--render` re-reads an old run and records nothing, since its cells were
/// measured at another time and commit.
fn finish(root: &Utf8Path, run: &Run, rows: &[Row], cases: &[Utf8PathBuf]) -> Result<()> {
    let saved = run_file(root);
    std::fs::write(&saved, serde_json::to_string(run)?)
        .with_context(|| format!("writing {saved}"))?;
    let (when, commit) = results::stamp(root);
    results::record(
        root,
        rows,
        &results::Run {
            measured: when,
            commit,
            lanes: run.lanes.as_deref(),
            spoiled: &run.spoiled,
        },
    )?;
    require_valid_rows(&run.failed)?;
    publish(
        root,
        rows,
        cases,
        &run.requested,
        &run.spoiled,
        run.lanes.as_deref(),
    )
}

/// The full benchmark table, every case and every column, written whole as
/// `results/benchmarks/full.md`.
///
/// Written by a program and never by hand: a table typed out by a person is a
/// table that drifts from the machine that produced it. It was a section of the
/// README between markers until 2026-10-23, when the README became a short
/// description of the project and every measured number moved under `results/`.
/// How to read a ratio that moved, which the shape of the table hides.
///
/// Split from [`legend`] for the length limit, and it is a real seam: the rest
/// of the legend says what each column *is*, and this says what a *change* in
/// one does and does not mean.
///
/// Both paragraphs come from the same day. A streaming rewrite made
/// `json-stringify-doc` 1.26x faster and moved its `nts/V8` from 2.24x to
/// 3.00x, because node gained 1.7x on the same change -- so the row reads as a
/// 34% loss and is a win. Nothing in a ratio can say that, and the lane that
/// wrote the improvement had to say it by hand.
fn reading_a_ratio() -> &'static str {
    "\n\
        **A ratio moving is not this compiler moving.** Every column is \
        measured in the same run, so a row can worsen while the program gets \
        faster — and did: `json-stringify-doc` went from 6.01 ms to 4.78 ms on \
        one change while its `nts/V8` went from 2.24x to **3.00x**, because the \
        same change bought node 1.7x against our 1.26x. Nothing regressed; V8 \
        exploits the streaming shape better than we do, and the ratio reports \
        that gap rather than the program. Compare a row against the previous \
        run's *absolute* numbers before reading its ratio as a direction.\n\n\
        And where two rows are one algorithm written two ways, the hosts \
        disagree about which way is better: on `json-stringify-typed` against \
        `json-stringify-inline`, Bun prefers the factored source and this \
        compiler prefers the inlined one, in opposite directions on the same \
        pair. **No single source is optimal for every column**, so those rows \
        measure a tradeoff rather than a result, and they are kept as a pair \
        for exactly that reason.\n"
}

/// What a reader has to know before the numbers mean anything.
///
/// Split from [`write_readme`] because the two are different kinds of thing:
/// one is the measurements, the other is the argument that they are
/// measurements of what the heading says.
const FIELD_IDIOM_LEGEND: &str = "\n\
    **Some `nts/V8` rows are V8 paying for a TypeScript idiom, not this \
    compiler winning.** The cases target ESNext, so a class field declared \
    without an initializer (`x: number;`) is defined as `undefined` when the \
    object is built, and node runs it so, as the semantics say. V8 then types \
    the field for any value rather than for the numbers it will hold, and a \
    double stored into it is a freshly allocated number. The same programs \
    with `declare x: number;` instead -- or as JavaScript, which declares no \
    fields -- run on node 7.5x faster on `awfy-nbody`, 3.4x on \
    `user-iterable`, 1.3x on `instanceof` and 1.2x on `awfy-bounce` (node \
    24.20, a quiet machine, 2026-10-15). The sources stay as a TypeScript programmer writes \
    them, so those rows' `nts/V8` is quoted twice: as measured, and divided \
    by the factor, against the node a JavaScript programmer would run. The \
    second is the one that says where this compiler stands -- \
    `user-iterable`'s 1.60x as measured is about 5.4x against the declared \
    shape, one of the worst rows rather than a mild one. `objects` is the \
    exception that keeps this from being a rule: declared, node runs it 1.2x \
    *slower*. `awfy-permute` pays 1.07x, and the other ten cases with such \
    fields nothing measurable.\n";

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
        `java`. `refused` means compilation was declined; `aborted` means the \
        compiled program terminated without a checksum. Its termination and \
        exact stderr are retained in the per-column outcome in `cells.tsv`, \
        and the row's note prints the runtime's message. Independent references \
        and engines still run, and every column that completes must agree.\n\n\
        `Java` is a hand-written reference for the same benchmark, on the same \
        JVM in the same run — the only reference here written in the language \
        the column beside it compiles to, which is what makes `nts (JVM)/Java` \
        a statement about codegen with the runtime divided out. Every other \
        ratio in this table mixes a codegen difference with an engine \
        difference and cannot separate them. On the `awfy-*` rows it is Are We \
        Fast Yet's **own** Java, unchanged; everywhere else it is a `ref.java` \
        beside the case, whose comment says what a competent Java programmer \
        would write and why. A reference must decline anything that costs one \
        lane and not the other — no boxing where the subject boxes nothing, no \
        field narrower than the f64 a TypeScript `number` is — and four of \
        these were corrected for exactly that, in both directions.\n\n\
        **Below about 1.10x, this column is at its resolution and should be \
        read with the fixed-count driver rather than from here.** The number is \
        a best-of-five, which is the right statistic against a tight \
        distribution and a kind one against a wide one — and where a JIT \
        settles two ways, ours is the wide one. `tooling/bench/counted.sh` \
        calls a case's own entry point N times and again at 2N and subtracts, \
        which removes startup and warmup and reports a median; records 0154 \
        and 0155 are three rows that read differently under it, in both \
        directions, one of them a loss published as a win. The spread table \
        below catches a row that is unstable *within* one invocation and \
        cannot catch one that settles differently between them.\n\n\
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
    let legend = format!("{legend}{FIELD_IDIOM_LEGEND}{}", reading_a_ratio());
    // **Which tree's binary wrote this, beside which commit it measured.**
    //
    // The sha answers "what was measured" and had been the whole of the
    // provenance. The question a reader actually arrives with is different, and
    // it is the one `repository_root` warns about: this destination comes from
    // `CARGO_MANIFEST_DIR`, baked in at *compile* time, so a binary built in the
    // main checkout rewrites the main checkout's `results/benchmarks/` however it is invoked --
    // from a sealed worktree included.
    //
    // On 2026-09-15 two sessions spent an exchange working out whose uncommitted
    // README edit it was, and the answer was that a *program* had written it.
    // `nts-suite` carries a doc comment recording the same thing happening
    // before, and both of us had read one of the two copies. A comment lives
    // with the code that writes; the person who needs it is looking at a diff in
    // a file with no code in it, and the recognisable moment -- "this changed
    // and I do not know who changed it" -- happens to the reader. So the answer
    // goes in the artefact rather than beside the writer.
    let manifest = env!("CARGO_MANIFEST_DIR");
    let legend = format!(
        "{legend}\nMeasured at `{commit}`, one case at a time, on cores pinned away from \
         the other sessions sharing this checkout, with the benchmark lock held so nothing \
         else was running. Written by `nts-bench` built in `{manifest}`, which is also what \
         decided *this* file: the destination is the binary's `CARGO_MANIFEST_DIR`, fixed \
         when it was compiled rather than when it was run.\n"
    );

    legend
}

/// The rows whose own five passes disagreed, rendered where they are quoted.
///
/// The console printed these and the README carried none of them, so a reader
/// of the table met a coin flip as a fact. `awfy-sieve` is the case that forced
/// it: 5.74, 5.74 and 5.38 us on one sitting and 4.49, 4.44 and 4.48 on
/// another, out of one class file. That is 1.27x or 1.03x against Java, and
/// **whichever the publishing run happens to get looks entirely plausible in a
/// table** -- there is nothing in the number itself to say it was a flip.
///
/// Empty when nothing varied, so a stable run adds no section rather than a
/// heading saying "none", which would go stale as reassurance.
fn spreads(rows: &[Row]) -> String {
    use std::fmt::Write as _;
    let mut lines = String::new();
    for row in rows {
        for (label, spread) in &row.varied {
            let _ = writeln!(
                lines,
                "| {} | {label} | {spread:.2}x | this run |",
                row.case
            );
        }
        // **And the ones a lucky run does not see.** `varied` is what *this*
        // sitting observed, so a row that flips one time in six publishes a bare
        // number on the five sittings that did not catch it -- which is exactly
        // the failure this section was written to prevent, arriving through the
        // section itself.
        //
        // The JVM lane found it from outside: `tooling/bench` publishes
        // `awfy-sieve` at 0.94x and their device harness reads 1.32x and 1.33x
        // on two sittings, with every other shared row agreeing. Two instruments
        // differing by 40% on one row, reproducibly.
        for (case, label, spread, seen, basis) in KNOWN_BIMODAL {
            if row.case == *case && !row.varied.iter().any(|(at, _)| at == label) {
                let _ = writeln!(
                    lines,
                    "| {case} | {label} | {spread:.2}x | {seen} — {} |",
                    basis.shown()
                );
            }
        }
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "\n**These rows disagreed with themselves.** Measured five times from the \
         same binary, their passes did not agree, so each published number says \
         which shape the JIT settled into rather than how fast the program is, \
         and a rerun may land on another shape. They are listed because the table \
         cannot show it: a flipped row and a solid one are the same number on the \
         page.\n\n\
         | case | column | spread | observed |\n\
         | --- | --- | ---: | --- |\n{lines}"
    )
}

/// The mark on a ratio against node that measures work nts does not do.
const ASYMMETRIC: char = '\u{b6}';

/// `cell` with `mark` after it where `marked` holds; a `--` stays bare.
fn marked(cell: String, marked: bool, mark: char) -> String {
    if marked && cell != "--" {
        format!("{cell}{mark}")
    } else {
        cell
    }
}

/// What the `ASYMMETRIC` mark means, for each case that carries it.
fn asymmetric(rows: &[Row]) -> String {
    use std::fmt::Write as _;
    let mut said = String::new();
    for row in rows {
        if let Some(why) = row.asymmetry() {
            let _ = write!(said, "\n{ASYMMETRIC} `{}`: {why}.\n", row.case);
        }
    }
    said
}

fn write_full_table(root: &Utf8Path, rows: &[Row]) -> Result<Utf8PathBuf> {
    use std::fmt::Write as _;
    let mut table = String::new();
    let with_bun = rows.iter().any(|row| row.bun.is_some());
    // `nts f64` is measured on every run and printed by the tool; it is not
    // published. It answers "what does the analysis buy", which is a question
    // about this compiler's insides rather than about how fast the thing is,
    // and a reader comparing against V8 does not need a column for it.
    let mut headers = vec![
        "case",
        "C++",
        "nts (C)",
        "nts (LLVM)",
        "nts (JVM)",
        "Java",
        "V8",
    ];
    if with_bun {
        headers.push("Bun");
    }
    headers.extend(["nts/C++", "nts/V8"]);
    if with_bun {
        headers.push("nts/Bun");
    }
    headers.push("nts (JVM)/Java");
    let _ = writeln!(table, "| {} |", headers.join(" | "));
    let _ = writeln!(table, "| {} |", vec!["---:"; headers.len()].join(" | "));
    for row in rows {
        let mut cells = vec![
            row.case.clone(),
            row.cpp.map_or_else(|| "--".to_owned(), human),
            row.nts.map_or_else(|| "--".to_owned(), human),
            format!("**{}**", row.llvm.map_or_else(|| "--".to_owned(), human)),
            jvm_cell(row.jvm, row.jvm_absence),
            row.java.map_or_else(|| "--".to_owned(), human),
            human(row.node),
        ];
        if with_bun {
            cells.push(row.bun.map_or_else(|| "--".to_owned(), human));
        }
        cells.push(row.quotable(row.against(row.cpp), ["nts (C)", "C++"]));
        cells.push(marked(
            row.quotable(row.against(Some(row.node)), ["nts (C)", "node"]),
            row.asymmetry().is_some(),
            ASYMMETRIC,
        ));
        if with_bun {
            cells.push(row.against(row.bun));
        }
        cells.push(row.quotable(row.jvm_against_java(), ["nts (JVM)", "Java"]));
        let _ = writeln!(table, "| {} |", cells.join(" | "));
    }

    let legend = legend(root);
    let mut spreads = spreads(rows);
    for row in rows {
        if let Some(reason) = &row.cpp_absence {
            use std::fmt::Write as _;
            let _ = writeln!(spreads, "\n{}: {reason}.", row.case);
        }
    }
    // The dagger is only worth printing where one was, and a legend line that
    // explains a mark nothing carries reads as a warning about the whole table.
    let daggered = rows.iter().any(|row| {
        ["nts (C)", "C++", "node", "nts (JVM)", "Java"]
            .iter()
            .any(|label| row.unstable(label))
    });
    // The mark travels with the number. `spreads` below says *what* moved and
    // by how much; this says which ratios one may not quote, in the cell a
    // reader copies.
    let mark = if daggered {
        "\n\u{2020} one half of this ratio is known to move — see the table below.          **A ratio is unquotable when either half moves**, whichever half it is:          the bar is ours over theirs, so a moving denominator moves the bar.\n"
    } else {
        ""
    };
    let marks = asymmetric(rows);
    let dir = root.join("results/benchmarks");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {dir}"))?;
    let path = dir.join("full.md");
    let written = format!(
        "# Every case, every column\n\nWritten by `nts-bench` from a clean full run \
         only: every case, every lane, nothing else running. The per-target tables \
         beside it (`c.md`, `llvm.md`, `jvm.md`) record every run.\n\n\
         {table}{mark}{marks}{legend}{spreads}"
    );
    std::fs::write(&path, written).with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// One case's timings, kept so the full table can be written from the same numbers
/// the terminal showed.
struct Row {
    case: String,
    /// The hand-written reference. `None` where the case has no `ref.cpp`,
    /// which real-world code taken from elsewhere generally will not: writing
    /// a second implementation of it in C++ to have something to divide by is
    /// a correctness burden rather than a reference.
    cpp: Option<f64>,
    /// Optional reference dependencies that were unavailable on this host.
    cpp_absence: Option<String>,
    outcomes: std::collections::BTreeMap<execution::Column, execution::Outcome>,
    /// This compiler's primary lane. **`None` where it refused the program.**
    ///
    /// Non-optional until 2026-09-15, which meant "this compiler cannot compile
    /// this case" had no representation and necessarily became a *lost row* --
    /// and a lost row stops the whole full table from being published, because a
    /// table missing a row it used to carry answers a different question.
    ///
    /// So one correct refusal took the entire table down. `json-stringify-doc`
    /// is the case: `c9f3d3a0` refuses a structural-to-subclass pointer cast
    /// that used to be a SIGSEGV, that case's `work` reaches `options.replacer`
    /// on an anonymous type not declaring it, and lowering drops the function.
    /// The refusal is right; losing every other row over it is not.
    ///
    /// The README already had the vocabulary -- its legend says a `--` in a
    /// backend column is "a program it refuses" -- and only this type could not
    /// say it.
    nts: Option<f64>,
    unspecialized: Option<f64>,
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
    /// Columns whose own five passes disagreed, and by how much.
    ///
    /// These were an `eprintln!` and nothing else, so they reached a person
    /// watching the run and never the file the numbers get quoted from. The
    /// legend already said "the `varied` notes above", which is true of the
    /// console and false of the README, where there is nothing above -- so the
    /// published text pointed at a warning a published reader could not see.
    varied: Vec<(String, f64)>,
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

    /// Whether a named column is known to be unstable — this sitting, or a
    /// previous one.
    fn unstable(&self, label: &str) -> bool {
        self.varied.iter().any(|(at, _)| at == label)
            || KNOWN_BIMODAL
                .iter()
                .any(|(case, at, ..)| *case == self.case && *at == label)
    }

    /// A ratio, marked where **either half** of it is known to move.
    ///
    /// The JVM lane's sentence, and it took a retraction to arrive at: *a ratio
    /// is unquotable when either half moves*. `number-format-double` was
    /// promoted to "the best-supported number in the table" on the reasoning
    /// that its flag was on the *Java* side — the reference varied, not us — so
    /// a note about the reference was making our own stable number unquotable.
    /// That identifies the unstable half correctly and draws the opposite
    /// conclusion: the bar is ours **over** theirs, so a moving denominator
    /// moves the bar.
    ///
    /// Marked where the number is read, not in a section below it. `spreads`
    /// already exists and was not enough — a reader quotes the cell.
    fn quotable(&self, ratio: String, halves: [&str; 2]) -> String {
        if ratio == "--" || !halves.iter().any(|label| self.unstable(label)) {
            return ratio;
        }
        format!("{ratio}\u{2020}")
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

    /// Why node's column measures work nts does not do, where it does.
    fn asymmetry(&self) -> Option<&'static str> {
        let case = self.case.strip_suffix(" (rc)").unwrap_or(&self.case);
        KNOWN_ASYMMETRIC
            .iter()
            .find(|(name, _)| *name == case)
            .map(|(_, why)| *why)
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum JvmAbsence {
    RuntimeAbort,
    /// The backend declined a construct, by name, at emit time.
    Refused,
    /// The backend emitted it and the harness has no way to drive it.
    NoDriver,
    /// `NTS_BENCH_LANES` left the lane out, so nothing was asked.
    ///
    /// It rendered as `refused` until 2026-09-29, because a filtered lane
    /// pushes no result and recorded no absence -- and a run with
    /// `NTS_BENCH_LANES=c` then reported six JVM refusals that were six lanes
    /// nobody ran, which a reader took for a row of the backend's gaps.
    NotRun,
}

/// Which memory provider a case runs under: reference counting, always.
///
/// It is what a shipped program uses -- `NoGC` never frees, and is for testing
/// only (the user, 2026-10-22: "I do not think anyone should ship like this")
/// -- and the table is a claim about what ships. Cases used to choose: a
/// `provider` file saying `rc` beside an allocating one, `NoGC` otherwise, with
/// `NTS_BENCH_RC=1` to count everywhere. The rows without it measured a
/// program nobody would run, and the answer for the one that builds a linked
/// list was 12x.
fn provider_for(_case: &Utf8Path) -> hir::Memory {
    hir::Memory::ReferenceCounting
}

/// The runtime translation units every variant of a case links.
///
/// The Unicode tables join them only for a case that converts case: linking
/// them always takes `tests/programs/hello` from 81 KB to 162 KB, and a benchmark
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

fn run_case(root: &Utf8Path, case: &Utf8Path, out: &Utf8Path) -> Result<Measurements> {
    let name = case.file_name().context("a case needs a name")?;
    let tsconfig = case_tsconfig(case, out, name)?;

    // A case that allocates per iteration has to say so. Under NoGC it would
    // never free, so a run calibrated to a hundred milliseconds would measure
    // page faults rather than the code -- and the provider is a property of the
    // workload, not of the compiler.
    let provider = provider_for(case);
    let defines: &[&str] = match provider {
        hir::Memory::ReferenceCounting => &["-DNTS_PROVIDER_RC"],
        hir::Memory::NoGc => &[],
        hir::Memory::HostGc => bail!("NTS2001: native C/LLVM benchmarks decline HostGc"),
    };
    // Every case counts references now, so the row says its name and not
    // `name (rc)`: a suffix every row carried would distinguish nothing.
    let shown = name.to_owned();
    references::validate(case)?;

    let specialized = out.join(format!("{name}.specialized.c"));
    let plain = out.join(format!("{name}.plain.c"));
    let rendered = out.join(format!("{name}.specialized.ll"));
    // Capture once for both the source contract and the first compilation.
    // Drop the checker snapshot before any timed child runs.
    let (workload, specialized_text) = {
        let snapshot = capture_snapshot(&tsconfig)?;
        let custom = ["driver.cpp", "driver.java", "driver.mjs"]
            .iter()
            .all(|driver| case.join(driver).exists());
        let workload = workload::Workload::from_source(&snapshot, &case.join("case.ts"), custom)?;
        let program = prepare_snapshot(
            &snapshot,
            &workload.roots,
            true,
            provider,
            nts_codegen_common::Backend::C,
        )?;
        let text = emit_program(&program, false);
        (workload, text)
    };
    let entry = &workload.roots;
    if let Ok(numeric) = workload.numeric() {
        println!("workload: {shown}: {}({})", numeric.callee, numeric.input());
    }
    let needs_unicode = reaches_unicode(&specialized_text);
    // Whether the program has top-level code to evaluate. `module__init` is
    // emitted only when it does, and calling a function that was never emitted
    // is a link error -- which is `standalone_main`'s own rule, applied here.
    let initializes = specialized_text.contains("void module__init(void)");
    // Whether this compiler kept the function the driver calls. When it did not,
    // every lane of *ours* is absent for one reason -- the program was refused --
    // and the references and the engines still measure, so the row is a real row
    // with `--` in four cells rather than a case that vanished.
    let refused = missing_entry(&specialized_text, &driver_entries(entry));
    if let Some(ref name) = refused {
        eprintln!(
            "note: {shown:<16} this compiler refuses `{name}`, so its four columns \
             are `--`; the references and the engines still ran"
        );
    }
    let lowers = refused.is_none();
    std::fs::write(&specialized, &specialized_text)
        .with_context(|| format!("writing {specialized}"))?;
    std::fs::write(&plain, emit(&tsconfig, entry, false, provider, false)?)
        .with_context(|| format!("writing {plain}"))?;
    // The second backend is allowed to fail here and further down. Anything it
    // cannot render leaves its column empty rather than taking the row with it.
    let renderable = match emit(&tsconfig, entry, true, provider, true) {
        Ok(text) => std::fs::write(&rendered, text).is_ok(),
        Err(_) => false,
    };

    let emission = Emission {
        renderable,
        initializes,
        needs_unicode,
        refused: refused.as_deref(),
    };
    let (results, absences) = variants(
        root,
        case,
        out,
        name,
        &tsconfig,
        provider,
        defines,
        &specialized,
        &plain,
        &rendered,
        emission,
        &workload,
    )?;
    let (node, bun) = measure_hosts(case, out, name, &workload)?;
    Ok(Measurements {
        workload: Some(workload),
        shown,
        results,
        absences,
        lowers,
        node,
        bun,
    })
}

/// What emitting the case established, before anything is built.
///
/// Threading these as loose arguments tripped `fn_params_excessive_bools`, and
/// the lint is right for a reason beyond counting: `true, false, true, true` at
/// a call site says nothing, and they are all one subject -- what this compiler
/// managed to produce for this case.
///
/// The fourth is the refused entry point **by name rather than as a `bool`**,
/// which `struct_excessive_bools` then asked for and which is the better field
/// anyway: "refused" is a question with an answer, and the answer is which
/// function lowering would not keep.
#[derive(Clone, Copy)]
struct Emission<'a> {
    /// The LLVM backend rendered it.
    renderable: bool,
    /// The program has top-level code, so `module__init` exists to call.
    initializes: bool,
    /// The program reaches the Unicode tables, which are linked only then.
    needs_unicode: bool,
    /// The entry point lowering refused, if it refused one. `Some` takes all
    /// four of this compiler's lanes rather than one: the refusal is in the
    /// middle end, above every backend.
    refused: Option<&'a str>,
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
    provider: hir::Memory,
    defines: &[&str],
    specialized: &Utf8Path,
    plain: &Utf8Path,
    rendered: &Utf8Path,
    emission: Emission<'_>,
    workload: &workload::Workload,
) -> Result<(Vec<Option<Measured>>, Absences)> {
    let mut results: Vec<Option<Measured>> = Vec::new();
    // Why the JVM column is empty, where it is. Two different absences that a
    // single blank -- or a single `refused` -- would flatten into one.
    let mut jvm_absence: Option<JvmAbsence> = None;
    let mut cpp_absence = None;
    let mut outcomes = std::collections::BTreeMap::new();
    let driver = native_driver(case, out, name, emission.initializes, workload)?;
    // Only the lanes asked for. `NTS_BENCH_LANES=jvm` compiles no C++, no C and
    // no LLVM, which is most of a run's wall clock: every other lane goes
    // through `clang -flto` per case and the JVM lane goes through `javac`.
    //
    // For iterating on one backend this is the difference between a filtered
    // run that answers in seconds and one that answers in minutes, and the
    // published table is the *unfiltered* run -- `wanted_lanes` returning
    // `None` is the default and changes nothing.
    let lanes = wanted_lanes();
    for variant in VARIANTS {
        if let Some(ref only) = lanes
            && !only.iter().any(|want| lane_matches(want, variant.label))
        {
            if matches!(variant.generated, Generated::Jvm) {
                jvm_absence = Some(JvmAbsence::NotRun);
            }
            results.push(None);
            continue;
        }
        // Nothing of ours to build when lowering refused the entry point, and
        // that is all four of our lanes rather than one: the refusal is in the
        // middle end, above every backend, so C, the unspecialised control, LLVM
        // and the JVM lose the same function. `C++` and `Java` are hand-written
        // and unaffected, which is what makes the row still worth having -- it
        // keeps saying what the references and the engines cost.
        if emission.refused.is_some() && variant.label.starts_with("nts") {
            results.push(None);
            continue;
        }
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
        let libraries = if variant.generated == Generated::None {
            let libraries = reference_link::Libraries::read(case)?;
            if let Some(reason) = libraries.probe(&out.join(format!("{name}.reference-link")))? {
                cpp_absence = Some(reason);
                results.push(None);
                continue;
            }
            libraries
        } else {
            reference_link::Libraries::default()
        };
        let front = if variant.generated == Generated::None {
            source
        } else {
            driver.clone()
        };
        let cpp = vec![front, root.join("benchmarks/common/main.cpp")];
        let mut c = runtime_sources(out, emission.needs_unicode);
        match variant.generated {
            // Not a C++ file linked against a generated object, so it leaves
            // this loop rather than joining the command line below. A refused
            // program has no classes, which empties the column and leaves the
            // row -- the same bargain the LLVM column keeps.
            Generated::Jvm => {
                let run = jvm_case(root, case, out, name, tsconfig, provider, workload);
                match observe(run, Generated::Jvm, &mut outcomes) {
                    Ok(measured) => {
                        if measured.is_none() {
                            jvm_absence = Some(JvmAbsence::RuntimeAbort);
                        }
                        results.push(measured);
                    }
                    Err(error) if error.to_string().starts_with(DECLINED) => {
                        jvm_absence = Some(JvmAbsence::Refused);
                        results.push(None);
                    }
                    Err(error) => return Err(error),
                }
                continue;
            }
            Generated::JavaReference => {
                results.push(java_cell(root, case, out, name));
                continue;
            }
            Generated::Specialized => c.push(specialized.to_owned()),
            Generated::Unspecialized => c.push(plain.to_owned()),
            Generated::Llvm if emission.renderable => c.push(rendered.to_owned()),
            Generated::Llvm => {
                results.push(None);
                continue;
            }
            Generated::None => {}
        }
        let built = compile(root, &cpp, &c, &binary, defines, &libraries)
            .and_then(|()| measure(&mut std::process::Command::new(&binary)));
        results.push(observe(built, variant.generated, &mut outcomes)?);
    }
    Ok((
        results,
        Absences {
            jvm: jvm_absence,
            cpp: cpp_absence,
            outcomes,
        },
    ))
}

/// Keep program termination apart from a broken compiler, build or tool.
fn observe(
    result: Result<Measured>,
    generated: Generated,
    outcomes: &mut std::collections::BTreeMap<execution::Column, execution::Outcome>,
) -> Result<Option<Measured>> {
    match result {
        Ok(measured) => Ok(Some(measured)),
        Err(error) => {
            if let (Some(column), Some(outcome)) = (
                execution::Column::from_generated(generated),
                error.downcast_ref::<execution::Outcome>(),
            ) {
                outcomes.insert(column, outcome.clone());
                Ok(None)
            } else {
                Err(error)
            }
        }
    }
}

/// Why the columns that may be missing are, for one row.
#[derive(Serialize, Deserialize)]
struct Absences {
    #[serde(default)]
    outcomes: std::collections::BTreeMap<execution::Column, execution::Outcome>,
    jvm: Option<JvmAbsence>,
    #[serde(default)]
    cpp: Option<String>,
}

/// The engines, the checksum agreement, and the printed row.
///
/// Split from [`variants`] because they answer different questions: one builds
/// this compiler's output, the other asks what everybody else got and whether
/// the answers match.
/// Every lane in a family compiles the same work, so none may be an order of
/// magnitude from another.
fn work_agrees(row: &Row) -> Result<()> {
    // A reference and a subject that disagree about how much work to do are not
    // comparable, and the checksum cannot say so: every AWFY case answers 1 or
    // 0, and `nbody`'s `verifyResult` returns *true* for one iteration as
    // happily as for 250,000. Before this guard existed that row reported
    // **59.5ns against 7.36ms** for the same work and passed every check.
    //
    // # Why it is per family and not against the row
    //
    // The obvious generalisation -- flag any lane far from the row's median --
    // is wrong, because a large gap between *families* is frequently the point.
    // `exceptions` has Java 153x C++ because `fillInStackTrace` walks the
    // stack; `optional-chain` has node 37x C++ because one is a JIT and the
    // other is a native binary. Those are the findings, not defects.
    //
    // What must agree is work, and work is identical only *within* a family:
    //
    //   references      `ref.cpp` and `ref.java` -- two people, one problem
    //   this compiler   C, LLVM and JVM -- one program, three backends
    //   engines         node and bun -- one file, two engines
    //
    // `nts f64` is deliberately excluded. It is the same program compiled with
    // specialization off, and being much slower is the entire reason the column
    // exists: `closures` is 26x there and that is the measurement.
    //
    // Twenty times is far outside any codegen difference. Java can beat C++ on
    // a row and does; it cannot beat it by an order of magnitude on a numeric
    // kernel, so a gap that size means one of them is doing different work.
    for (family, lanes) in [
        (
            "hand-written references",
            vec![("C++", row.cpp), ("Java", row.java)],
        ),
        (
            "this compiler's backends",
            vec![
                ("nts C", row.nts),
                ("nts LLVM", row.llvm),
                ("nts JVM", row.jvm),
            ],
        ),
        ("engines", vec![("node", Some(row.node)), ("bun", row.bun)]),
    ] {
        // `NaN` marks a lane a filter excluded, not a lane that ran fast.
        let ran: Vec<(&str, f64)> = lanes
            .into_iter()
            .filter_map(|(l, t)| t.filter(|t| t.is_finite()).map(|t| (l, t)))
            .collect();
        let Some((slow, slowest)) = ran.iter().copied().max_by(|a, b| a.1.total_cmp(&b.1)) else {
            continue;
        };
        let Some((fast, fastest)) = ran.iter().copied().min_by(|a, b| a.1.total_cmp(&b.1)) else {
            continue;
        };
        if fastest * 20.0 >= slowest {
            continue;
        }
        if let Some((_, why)) = WIDE_REFERENCE_GAPS
            .iter()
            .find(|(which, _)| *which == row.case)
        {
            eprintln!(
                "note: {} -- {slow} {} against {fast} {} -- {}",
                row.case,
                human(slowest),
                human(fastest),
                why
            );
        } else {
            bail!(
                "on {}, {slow} ran in {} against {} for {} -- both are {family}, \
             so they compile the same work and cannot differ by that much. \
             One of them is doing a different amount of it: check the \
             problem size each states, in `case.ts`'s `seed`, `ref.cpp`'s \
             `volatile`, and `ref.java`'s.",
                row.case,
                human(slowest),
                human(fastest),
                fast
            );
        }
    }
    Ok(())
}

/// Which lanes to run, from `NTS_BENCH_LANES`, or every one.
///
/// `NTS_BENCH_LANES=jvm` runs the JVM backend, the Java reference and node.
/// Anything filtered out renders `--`, the same as a lane that refused, so a
/// filtered run is never mistaken for a published one -- and `publish`
/// refuses to write the full table from a filtered run for the same reason a
/// filtered *case* list does.
fn wanted_lanes() -> Option<Vec<String>> {
    let raw = std::env::var("NTS_BENCH_LANES").ok()?;
    let lanes: Vec<String> = raw
        .split(',')
        .map(|lane| lane.trim().to_lowercase())
        .filter(|lane| !lane.is_empty())
        .collect();
    (!lanes.is_empty()).then_some(lanes)
}

/// Whether a lane name from `NTS_BENCH_LANES` selects a variant.
///
/// `jvm` selects both `nts (jvm)` and `Java`, because a ratio needs both halves
/// and asking for one without the other is never what anybody means.
fn lane_matches(want: &str, label: &str) -> bool {
    let label = label.to_lowercase();
    match want {
        "jvm" => label.contains("jvm") || label == "java",
        "llvm" => label.contains("llvm"),
        "c" => label == "nts" || label == "c++",
        "f64" => label.contains("f64"),
        // **No fall-through.** `NTS_BENCH_LANES=native` is not a lane -- the C
        // selector is `c` -- and the arm that used to be here read
        // `label.contains(other)`, matched nothing, and produced a full table
        // with every nts column `--` and node's filled. A person read 78.75
        // against 79.42 ms off it and nearly took it as a result.
        //
        // A filter that matches nothing is the same failure as a discovery loop
        // that finds nothing and a comparison that compares nothing: the output
        // is shaped like an answer. `validate_lanes` refuses before any of it
        // runs, so this arm cannot be reached with an unknown name.
        _ => false,
    }
}

/// Every name `NTS_BENCH_LANES` accepts, so an unknown one is refused rather
/// than silently selecting nothing.
const LANES: &[&str] = &["jvm", "llvm", "c", "f64"];

/// Refuse an unknown lane name before a single case is compiled.
fn validate_lanes() -> Result<()> {
    let Some(wanted) = wanted_lanes() else {
        return Ok(());
    };
    let unknown: Vec<&str> = wanted
        .iter()
        .filter(|lane| !LANES.contains(&lane.as_str()))
        .map(String::as_str)
        .collect();
    if unknown.is_empty() {
        return Ok(());
    }
    bail!(
        "NTS_BENCH_LANES names {} which is not a lane -- the lanes are {}. \
         A name that selects nothing would print a table with every nts column \
         `--` and node's filled, which reads as a result.",
        unknown.join(", "),
        LANES.join(", ")
    )
}

/// One case's measurements, before they become a row: what a run saves
/// (`Run`), so that the table can be rendered again from them without timing
/// anything (`nts-bench --render`).
#[derive(Serialize, Deserialize)]
struct Measurements {
    /// The one source-derived call all generated columns received.
    /// Absent only in saved runs predating this contract.
    #[serde(default)]
    workload: Option<workload::Workload>,
    shown: String,
    results: Vec<Option<Measured>>,
    absences: Absences,
    lowers: bool,
    node: Measured,
    bun: Option<Measured>,
}

/// A run, as `target/bench/run.json` keeps it: what was asked, what was
/// measured, and what spoiled it. Rendering it again decides about the full table
/// exactly as the run did, from the same facts.
#[derive(Serialize, Deserialize)]
struct Run {
    lanes: Option<Vec<String>>,
    requested: Vec<String>,
    cases: Vec<String>,
    spoiled: Vec<String>,
    /// Build, checksum or work-comparability failures. Kept separately from
    /// measurements spoiled by load, which may still be useful observations.
    #[serde(default)]
    failed: Vec<String>,
    measured: Vec<Measurements>,
}

/// Keep the other rows and the rejected row's raw measurements, but never let
/// a printed `failed:` line become a successful run (including filtered runs).
fn accept_result<T>(name: &str, result: Result<T>, failed: &mut Vec<String>) -> Option<T> {
    match result {
        Ok(value) => Some(value),
        Err(error) => {
            println!("{name:<16} failed: {error:#}");
            let failure = format!("{name}: {error:#}");
            if !failed.contains(&failure) {
                failed.push(failure);
            }
            None
        }
    }
}

fn require_valid_rows(failed: &[String]) -> Result<()> {
    if !failed.is_empty() {
        bail!(
            "{} benchmark case(s) failed: {}",
            failed.len(),
            failed.join("; ")
        );
    }
    Ok(())
}

/// Where a run is saved, beside what it built.
fn run_file(root: &Utf8Path) -> Utf8PathBuf {
    root.join("target/bench/run.json")
}

/// Render the full table from a saved run (`--render [path]`): the rows are
/// assembled again by today's code from the measurements as they were taken,
/// so a change to how a row is judged reaches the table without re-timing it.
fn render(root: &Utf8Path, path: &Utf8Path) -> Result<()> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    let run: Run = serde_json::from_str(&text).with_context(|| format!("parsing {path}"))?;
    let filtered = run.lanes.is_some();
    let mut rows = Vec::new();
    let mut failed = run.failed.clone();
    for measured in &run.measured {
        if let Some(row) = accept_result(&measured.shown, assemble(measured, filtered), &mut failed)
        {
            rows.push(row);
        }
    }
    require_valid_rows(&failed)?;
    let cases_dir = root.join("benchmarks/cases");
    let cases: Vec<Utf8PathBuf> = run.cases.iter().map(|case| cases_dir.join(case)).collect();
    publish(
        root,
        &rows,
        &cases,
        &run.requested,
        &run.spoiled,
        run.lanes.as_deref(),
    )
}

/// node, and bun where it runs, over the case's own harness.
fn measure_hosts(
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    workload: &workload::Workload,
) -> Result<(Measured, Option<Measured>)> {
    let harness = node_harness(case, out, name, workload)?;
    let input: Vec<_> = workload
        .numeric()
        .ok()
        .map(workload::Numeric::input)
        .into_iter()
        .collect();
    let node = measure(
        std::process::Command::new("node")
            .arg(&harness)
            .args(&input),
    )?;
    // The same source on the other engine. Bun runs `.ts` natively too, so it
    // imports the identical file rather than a copy that could drift.
    // node always runs: it is the oracle every other lane's checksum is compared
    // against, and losing it would turn a filtered run into an unchecked one.
    // bun is a column rather than a check, so a filter may drop it.
    let bun = if wanted_lanes().is_some() {
        None
    } else {
        bun_binary()
            .map(|binary| {
                measure(
                    std::process::Command::new(binary)
                        .arg(&harness)
                        .args(&input),
                )
            })
            .transpose()?
    };
    Ok((node, bun))
}

/// A case's row, from its measurements: the checks a row must pass, and the
/// console line. Run after measuring, and again by `--render`. `filtered`
/// is whether `NTS_BENCH_LANES` chose the lanes.
/// Say which cells of a row are not a steady state, beside the row: a cell
/// whose passes disagree past `SPREAD_WORTH_SAYING`, and a JVM cell whose
/// warm-up reached its cap still compiling (`Bench.settle`).
fn note_unsteady_cells(shown: &str, results: &[Option<Measured>], row: &mut Row) {
    // A row whose own passes disagree has no single number, and printing one of
    // them as though it were the answer is the failure this table exists to
    // avoid. Said out loud rather than smoothed over; see `SPREAD_WORTH_SAYING`.
    for (label, measured) in [
        ("nts (JVM)", results.get(4)),
        ("Java", results.get(5)),
        ("nts (C)", results.get(1)),
    ] {
        if let Some(Some(measured)) = measured
            && measured.spread >= SPREAD_WORTH_SAYING
        {
            eprintln!(
                "note: {} {} varied {:.2}x across {} runs of the same binary -- \
                 the figure here is the minimum, which may still be reproducible; \
                 take six invocations before reading this as unquotable",
                shown, label, measured.spread, RUNS
            );
            row.varied.push((label.to_owned(), measured.spread));
        }
        if let Some(Some(measured)) = measured
            && measured.warm_capped
        {
            eprintln!(
                "note: {shown} {label} was still compiling when its warm-up reached the cap -- \
                 warm-capped: the figure may be the JIT's first tier rather than a steady state"
            );
        }
    }
}

fn assemble(measured: &Measurements, filtered: bool) -> Result<Row> {
    let Measurements {
        shown,
        results,
        absences,
        lowers,
        node,
        bun,
        ..
    } = measured;
    let (shown, lowers) = (shown.as_str(), *lowers);
    for (column, outcome) in &absences.outcomes {
        outcome.validate()?;
        if results
            .get(column.index())
            .and_then(Option::as_ref)
            .is_some()
        {
            bail!("{} has both a runtime abort and a timing", column.key());
        }
    }
    agreed(results, bun.as_ref(), node)?;

    // A lane that must run, unless a filter deliberately excluded it. Under
    // `NTS_BENCH_LANES` the C lanes are absent on purpose and their cells
    // render `--`; without one, an absent `nts` column is a failure, because
    // every ratio in the table divides by it.
    // Three ways our column can be absent, and only one of them is a defect.
    // A filter excluded it deliberately; this compiler refused the program, and
    // `--` is what the README's legend already calls that; or it should have run
    // and did not, which is the bug this `bail!` has always been for and which
    // the other two must not be allowed to look like.
    let required = |at: usize| -> Result<Option<f64>> {
        match results.get(at).and_then(Option::as_ref) {
            Some(measured) => Ok(Some(measured.ns_per_op)),
            None if filtered => Ok(Some(f64::NAN)),
            None if !lowers
                || VARIANTS
                    .get(at)
                    .and_then(|variant| execution::Column::from_generated(variant.generated))
                    .is_some_and(|column| absences.outcomes.contains_key(&column)) =>
            {
                Ok(None)
            }
            None => bail!("a variant that must run did not"),
        }
    };
    // A column allowed to be missing, for its own reasons.
    let optional = |at: usize| {
        results
            .get(at)
            .and_then(Option::as_ref)
            .map(|it| it.ns_per_op)
    };
    let mut row = Row {
        case: shown.to_owned(),
        cpp: optional(2),
        cpp_absence: absences.cpp.clone(),
        outcomes: absences.outcomes.clone(),
        nts: required(0)?,
        unspecialized: required(1)?,
        node: node.ns_per_op,
        llvm: optional(3),
        jvm: optional(4),
        jvm_absence: absences.jvm,
        java: optional(5),
        bun: bun.as_ref().map(|result| result.ns_per_op),
        varied: Vec::new(),
    };

    if let Some(reason) = &row.cpp_absence {
        println!("note: {shown:<16} {reason}");
    }
    for (column, outcome) in &row.outcomes {
        println!("note: {shown:<16} {} {outcome}", column.key());
    }
    note_unsteady_cells(shown, results, &mut row);

    work_agrees(&row)?;

    println!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
        row.case,
        row.cpp.map_or_else(|| "--".to_owned(), human),
        row.nts.map_or_else(|| "--".to_owned(), human),
        row.llvm.map_or_else(|| "--".to_owned(), human),
        jvm_cell(row.jvm, row.jvm_absence),
        row.java.map_or_else(|| "--".to_owned(), human),
        row.unspecialized.map_or_else(|| "--".to_owned(), human),
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

/// What the harnesses call, read off the case itself.
///
/// The checker supplies one numeric entry and its static numeric seed before
/// lowering. Legacy cases with a sole numeric export keep that entry name.
///
/// # Why every driver is generated rather than written
///
/// Every case states its workload once, in `case.ts`: the numeric `work` function is
/// what to call and `export const seed` is the argument. Every lane's driver --
/// the native `bench_run`, the JVM `Case.java`, the node harness -- comes from
/// those two facts, so a column cannot measure a different workload than the
/// column beside it. The workload is the same by construction rather than by
/// inspection.
///
/// This used to read `nts.cpp`, which made the *JVM* lane's driver a product of
/// parsing C++: the inputs had to be `volatile` scalars on their own lines and
/// the call a single-line `return`. Two lanes coupled through a text format
/// neither cared about, and a JVM number that moved if the C++ was reformatted.
///
/// Unsupported or ambiguous contracts fail before a driver is compiled.
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
        (None, Some(JvmAbsence::NotRun)) => "not run".to_owned(),
        (None, Some(JvmAbsence::RuntimeAbort)) => "aborted".to_owned(),
        (None, _) => "refused".to_owned(),
    }
}

/// How to compile a case, which is the same answer for all of them.
///
/// A `tsconfig.json` beside a case is still honoured, so one that needs
/// something the shared fixture config does not give can say so. None does
/// today.
///
/// Three used to, for `noUncheckedIndexedAccess`, and the comment in them said
/// it could not move to the shared file without breaking the forty-six cases
/// that did not ask for it. That was asserted and never measured, and it was
/// wrong twice: **all fifty cases typecheck with the flag on**, and the three
/// that carried it typecheck *without* it and produce byte-identical prepared
/// IR. It was doing nothing. So the answer was neither "move it to the shared
/// file" nor "keep three special cases" -- it was that there was no fact there
/// to place.
fn case_tsconfig(case: &Utf8Path, out: &Utf8Path, name: &str) -> Result<Utf8PathBuf> {
    let supplied = case.join("tsconfig.json");
    if supplied.exists() {
        return Ok(supplied);
    }
    let root = case
        .parent()
        .and_then(Utf8Path::parent)
        .and_then(Utf8Path::parent)
        .context("a case sits three levels below the repository root")?;
    let path = out.join(format!("{name}.tsconfig.json"));
    let text = format!(
        "{{\n  \"//\": \"Generated by tooling/bench. The case keeps no config of its own.\",\n  \"extends\": \"{root}/tsconfig.fixtures.json\",\n  \"include\": [\"{case}\"]\n}}\n"
    );
    std::fs::write(&path, text).with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// The node and bun harness, generated from the same workload.
///
/// Node 24 strips TypeScript types natively, so this imports the case's own
/// `.ts` rather than a hand-maintained JavaScript copy -- there is no second
/// version of the program to drift. Bun runs the identical file.
///
/// Written into `target/` and importing the case by absolute path, so the case
/// directory holds no generated file at all. Node resolves an absolute
/// specifier, which is what makes that possible -- a relative one would have to
/// resolve from where the importer sits.
fn node_harness(
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    workload: &workload::Workload,
) -> Result<Utf8PathBuf> {
    let supplied = case.join("driver.mjs");
    if supplied.exists() {
        return Ok(supplied);
    }
    let callee = &workload.numeric()?.callee;
    let common = case
        .parent()
        .and_then(Utf8Path::parent)
        .context("a case sits two levels below `benchmarks`")?
        .join("common/bench.mjs");
    let path = out.join(format!("{name}.bench.mjs"));
    // The seed arrives through `process.argv`, not by importing the `const`.
    //
    // This is the `volatile` the other two lanes spell with a keyword. An
    // imported module-level constant is exactly the loop-invariant argument the
    // native and JVM drivers go out of their way to hide: V8 folds it into the
    // call, specialises on it, and the row stops measuring the general program.
    // `argv` is opaque to the optimiser and free, and it is what this harness
    // did before the drivers were generated.
    let text = format!(
        "// Generated from `case.ts`. Edit that, or add a `driver.mjs` beside it.\n\
         import {{ measure }} from \"{common}\";\n\
         import {{ {callee} }} from \"{case}/case.ts\";\n\n\
         if (process.argv.length !== 3 || process.argv[2].trim() === \"\") {{\n\
             throw new Error(\"benchmark input missing: expected one numeric seed argument\");\n\
         }}\n\
         const seed = Number(process.argv[2]);\n\
         if (!Number.isFinite(seed)) throw new Error(\"benchmark input is not a finite number\");\n\
         measure(() => {callee}(seed));\n"
    );
    std::fs::write(&path, &text).with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// The Java column's cell: the hand-written Java's measurement, or none.
///
/// **`.ok().flatten()` used to be the whole of this**, and it made two
/// different facts print the same character. A case with no `ref.java` has no
/// Java column and should say `--`. A case *with* one that will not build has
/// no Java column either -- and that is a broken instrument, not a missing
/// reference.
///
/// A fresh worktree does not carry `third_party/are-we-fast-yet`, which the
/// eight `awfy-*` references construct their classes from, so a sweep taken in
/// one reports `--` for all eight and reads exactly like the nine `json-*`
/// cases that genuinely have no reference. It cost a whole sweep before I
/// looked.
///
/// So the reason is printed. Rule 6, in the harness that the rule is about: a
/// dash that means "not measured" has to say so.
fn java_cell(root: &Utf8Path, case: &Utf8Path, out: &Utf8Path, name: &str) -> Option<Measured> {
    match java_reference(root, case, out, name) {
        Ok(measured) => measured,
        Err(error) => {
            println!(
                "note: {:<16} has a ref.java that could not be measured, so its \
                 Java column is `--` for a reason that is not \"no reference\": {}",
                name,
                error.to_string().lines().next().unwrap_or("?"),
            );
            None
        }
    }
}

/// The `bench_run` the native harness calls, generated from the workload.
///
/// A case used to write this by hand as `nts.cpp`, forty-nine times, and
/// forty-eight of them were the same eleven lines with a different name and
/// number in them. The one that was not -- `elementwise`, which passes an array
/// and has to build one -- writes a `driver.cpp` instead, which is the same
/// escape hatch `driver.java` already is on the other lane.
///
/// `volatile` is not decoration. A loop-invariant argument lets the optimiser
/// hoist the whole call out of the timed region, and the benchmark then reports
/// an impressive zero.
fn native_driver(
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    initializes: bool,
    workload: &workload::Workload,
) -> Result<Utf8PathBuf> {
    use std::fmt::Write as _;

    let supplied = case.join("driver.cpp");
    if supplied.exists() {
        return Ok(supplied);
    }
    let numeric = workload.numeric()?;
    let callee = &numeric.callee;
    let arguments = [numeric.input()];
    let mut text = String::from(
        "// Generated from `case.ts`. Edit that, or add a `driver.cpp` here.\n\
         #include \"harness.h\"\n\n\
         // The generated program is C, so its symbols are C.\n\
         extern \"C\" {\n",
    );
    let _ = writeln!(
        text,
        "    double {callee}({});",
        vec!["double"; arguments.len()].join(", ")
    );
    let _ = writeln!(text, "    void nts_process_start(void);");
    if initializes {
        let _ = writeln!(text, "    void module__init(void);");
    }
    let _ = writeln!(text, "}}\n\ndouble bench_run(void) {{");
    // Module-level state is initialised by `module__init`, and a benchmark that
    // never calls it runs against whatever the loader left in those globals --
    // which for a `const` at module scope is null.
    //
    // The differential has always called it. No benchmark ever did, and for
    // forty-nine cases that was invisible because none of them had module-level
    // state whose initialisation mattered. `symbol-keyed-map` is the first, and
    // it surfaced as a *wrong answer* rather than a crash: its five symbols were
    // all null, so five distinct keys collapsed to one and every lookup hit it.
    //
    // Once, not per call: this is module evaluation, and it is not the workload.
    // So is the process's allocator policy, which a standalone program's `main`
    // sets before anything else and a row has to measure the same way.
    let _ = writeln!(text, "    static int ready = 0;");
    let init = if initializes { " module__init();" } else { "" };
    let _ = writeln!(
        text,
        "    if (!ready) {{ ready = 1; nts_process_start();{init} }}"
    );
    let mut passed = Vec::new();
    for (at, value) in arguments.iter().enumerate() {
        let _ = writeln!(text, "    volatile double in{at} = {value};");
        passed.push(format!("in{at}"));
    }
    let _ = writeln!(text, "    return {callee}({});\n}}", passed.join(", "));
    let path = out.join(format!("{name}.driver.cpp"));
    std::fs::write(&path, text).with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// One case through the JVM backend: classes, the runtime jar, a generated
/// driver, and `java`.
fn jvm_case(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
    tsconfig: &Utf8Path,
    provider: hir::Memory,
    workload: &workload::Workload,
) -> Result<Measured> {
    use std::fmt::Write as _;

    // A case declares `rc` because the *native* lane needs it: `NoGc` never
    // frees, so a run calibrated to a hundred milliseconds of work would
    // measure page faults rather than code. This lane has a tracing collector
    // underneath it and needs no such declaration -- and must not receive one,
    // because a `Retain` reaching a host-collected object would be a second
    // collector inside the platform's, which this backend refuses by name.
    //
    // Inheriting it meant six cases -- `map-and-set`, `pipeline`,
    // `case-convert`, `node-utf8`, `array-mutations`, `array-predicates` --
    // reported `refused` and were never timed here at all. That is not a
    // missing feature; it is the harness asking for a configuration this lane
    // is defined not to have, and then recording the refusal as the
    // compiler's. `NtsMap` had no timing on this backend for that reason.
    //
    // The workload's native allocation budget is independent of this target's
    // host-managed provider. Every native workload choice uses `HostGc` here.
    let provider = match provider {
        hir::Memory::ReferenceCounting | hir::Memory::NoGc | hir::Memory::HostGc => {
            hir::Memory::HostGc
        }
    };

    let supplied = case.join("driver.java");
    let numeric = if supplied.exists() {
        None
    } else {
        Some(workload.numeric()?)
    };
    let program = prepared_program(
        tsconfig,
        &workload.roots,
        true,
        provider,
        nts_codegen_common::Backend::Jvm,
    )?;
    let mismatches = nts_codegen_common::provider::host_gc_diagnostics(&program, "jvm");
    if !mismatches.is_empty() {
        let messages = mismatches
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>();
        bail!("{DECLINED}{}", messages.join("; "));
    }
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

    // A case whose workload cannot be written as one call with one scalar
    // supplies its own driver instead.
    //
    // `workload` reads `export const seed`, which every case has but the ones
    // that pass an array: `elementwise` hands the same buffer to each call and
    // refills it, so
    // there is no expression to synthesise and the state has to be reset between
    // runs or the contents compound and the checksum depends on how many times
    // the harness happened to call it.
    //
    // Verbatim rather than templated. A driver is twenty lines of Java that
    // belongs next to the case it drives, and inventing a substitution language
    // for the two cases that need one would be the larger mistake.
    let Some(numeric) = numeric else {
        let text =
            std::fs::read_to_string(&supplied).with_context(|| format!("reading {supplied}"))?;
        let driver_path = dir.join("Case.java");
        std::fs::write(&driver_path, text)?;
        return run_driver(root, &dir, &jar, &driver_path);
    };
    // The driver, from the workload the C shim already declares. Every input is
    // a `volatile` field for the reason the C shim makes them `volatile`: a
    // loop-invariant argument lets the JIT hoist the whole call out of the timed
    // loop and report an impressive zero.
    let callee = &numeric.callee;
    let arguments = [numeric.input()];
    let mut driver = String::from("public final class Case {\n");
    // Top-level code, before anything is timed.
    //
    // The native driver has called `module__init` since the day the defect was
    // found; this one never did, and the two were written apart. A benchmark
    // whose module-level state is never initialised measures a program whose
    // globals are all null, and for most cases that is a *different program*
    // that happens to compute the same answer -- which is why it stood.
    //
    // `symbol-keyed-map` is where it stopped being invisible: five module-level
    // `Symbol()` bindings, all null, so every key compared equal, the map held
    // one entry, and both lookups returned the last value written. 4096 x 8
    // against node's 4096 x 2.5. The harness's cross-lane checksum caught it on
    // the first run where the answer moved.
    //
    // A static initialiser rather than the native lane's `if (!ready)`: class
    // initialisation runs once, before `main`, and outside the measured region
    // entirely.
    if program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT)
    {
        let _ = writeln!(
            driver,
            "    static {{ nts.gen.Program.{}(); }}",
            nts_codegen_jvm::body::method_name(hir::lower::MODULE_INIT)
        );
    }
    let mut passed = Vec::new();
    for (at, value) in arguments.iter().enumerate() {
        let _ = writeln!(
            driver,
            "    private static volatile double in{at} = {value};"
        );
        passed.push(format!("in{at}"));
    }
    let _ = writeln!(driver, "    public static void main(String[] argv) {{");
    let _ = writeln!(driver, "        Bench.measure(new Bench.Work() {{");
    let _ = writeln!(driver, "            @Override public double run() {{");
    let _ = writeln!(
        driver,
        "                return nts.gen.Program.{}({});",
        nts_codegen_jvm::body::method_name(callee),
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
    let built = nts_codegen_jvm::toolchain::command(javac)
        .arg("-cp")
        .arg(dir)
        .arg("-d")
        .arg(dir)
        .arg(root.join("benchmarks/common/Bench.java"))
        .arg(driver_path)
        .output()
        .context("running javac")?;
    if !built.status.success() {
        bail!("javac: {}", String::from_utf8_lossy(&built.stderr));
    }

    let java = java_tool("java");
    measure(
        nts_codegen_jvm::toolchain::command(java)
            // Explicit rather than ergonomic: the default collector changes with
            // the host, and a column that changes meaning with the machine is
            // not an instrument. Equal bounds so no resizing happens mid-run.
            .args(["-XX:+UseG1GC", "-Xms512m", "-Xmx512m"])
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
/// The driver mirrors `benchmarks/cases/awfy-*/src/main.ts` exactly: construct the
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
    // `Ref` *is* the `Bench.Work`, rather than something a `Bench.Work` calls.
    //
    // The wrapper was not free. `awfy-sieve`'s reference measured 4.7us with
    // the workload inline in `run()` and **5.5us behind one extra static call**
    // -- 18%, on a row whose whole body is a sieve over 5000 flags. The call
    // itself is nothing; what it costs is inlining, because AWFY's benchmarks
    // are already three deep before the harness adds a fourth.
    //
    // An 18% tax on the *reference* lane makes this compiler look better, which
    // is the one direction a harness must never be wrong in.
    let mut driver = String::from("public final class Case {\n");
    let _ = writeln!(driver, "    public static void main(String[] argv) {{");
    let _ = writeln!(driver, "        Bench.measure(new Ref());");
    let _ = writeln!(driver, "    }}\n}}");
    let driver_path = dir.join("Case.java");
    std::fs::write(&driver_path, driver)?;

    // Are We Fast Yet's own classes, on the classpath, when the clone is there.
    //
    // This is what `ref.cpp` does with their headers: the eight `awfy-*` cases
    // have a `ref.java` that constructs one of their classes and calls
    // `innerBenchmarkLoop`, and the class stays theirs. It is unconditional
    // rather than per-case because a classpath entry that nothing imports costs
    // nothing, and the alternative is a list of which cases are allowed to see
    // it -- which is the table this replaced.
    let awfy = awfy_classes(root, out)?;
    let mut classpath = dir.to_string();
    if let Some(ref classes) = awfy {
        classpath = format!("{classes}:{classpath}");
    }
    let mut javac = nts_codegen_jvm::toolchain::command(java_tool("javac"));
    javac.arg("-nowarn");
    if let Some(ref classes) = awfy {
        javac.arg("-cp").arg(classes.as_str());
    }
    let compiled = javac
        .arg("-d")
        .arg(dir.as_str())
        .arg(case.join("ref.java").as_str())
        .arg(root.join("benchmarks/common/Bench.java").as_str())
        .arg(driver_path.as_str())
        .output()
        .context("running javac over a hand-written Java reference")?;
    if !compiled.status.success() {
        bail!("javac: {}", String::from_utf8_lossy(&compiled.stderr));
    }

    measure(
        nts_codegen_jvm::toolchain::command(java_tool("java"))
            .args(["-XX:+UseG1GC", "-Xms512m", "-Xmx512m"])
            .arg("-cp")
            .arg(&classpath)
            .arg("Case"),
    )
}

/// Are We Fast Yet's Java sources, compiled once and shared by every case.
///
/// `Ok(None)` where the suite is not cloned, which is the same bargain the C++
/// column keeps: the reference is absent and the cell renders `--`, rather than
/// the run failing.
fn awfy_classes(root: &Utf8Path, out: &Utf8Path) -> Result<Option<Utf8PathBuf>> {
    let sources = root.join("third_party/are-we-fast-yet/benchmarks/Java/src");
    if !sources.exists() {
        return Ok(None);
    }
    // Keyed on a marker file rather than on the directory existing, so a build
    // that died halfway is rebuilt rather than reused.
    let built = out.join("awfy-java");
    if built.join(".complete").exists() {
        return Ok(Some(built));
    }
    std::fs::create_dir_all(&built)?;
    let mut listing = Vec::new();
    collect_java(&sources, &mut listing)?;
    let compiled = nts_codegen_jvm::toolchain::command(java_tool("javac"))
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
    Ok(Some(built))
}

/// The `Java` column for one case: its `ref.java`, or nothing.
///
/// There used to be a second path here. The eight `awfy-*` cases had no
/// `ref.java` and were served instead by a table mapping case name to one of
/// Are We Fast Yet's class names, plus a synthesised driver -- which was
/// `ref.cpp` written in Rust rather than by a person, and it made those eight
/// rows the only ones whose Java reference could not be read beside the case.
/// They have a `ref.java` now and the table is gone.
fn java_reference(
    root: &Utf8Path,
    case: &Utf8Path,
    out: &Utf8Path,
    name: &str,
) -> Result<Option<Measured>> {
    if !case.join("ref.java").exists() {
        return Ok(None);
    }
    handwritten_java(root, case, out, name).map(Some)
}

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

/// The entry names the native driver actually calls.
///
/// `entry_points` appends `MODULE_INIT` as a *reachability* root -- "module
/// evaluation is a root in the same sense the entry point is" -- and it is
/// neither called by the driver unconditionally nor spelled the same way: the C
/// is `void module__init(void)`, with the `#` mangled to `__`.
///
/// **Handing it to `missing_entry` reported every case in the corpus as
/// refused**, blanking all four of this compiler's columns on a clean sweep,
/// because a definition of `module#init(` exists nowhere. Whether module
/// evaluation was emitted is already `initializes`, and the driver calls it
/// only when it was.
///
/// Caught by watching the first two rows of a full run rather than by any test,
/// which is the finding: the change had been verified on the case that *is*
/// refused and never on one that is not. A detector needs its negative control
/// more than its positive one -- the positive is the case you were thinking
/// about.
fn driver_entries(entry: &[String]) -> Vec<String> {
    entry
        .iter()
        .filter(|name| *name != hir::lower::MODULE_INIT)
        .cloned()
        .collect()
}

/// The entry point the driver calls, if lowering did not keep it.
///
/// **`emit-c` refuses and exits zero.** It renders what it can and reports the
/// rest as diagnostics, so a function lowering dropped leaves a C file that
/// compiles perfectly -- `clang -c` has no opinion about a translation unit with
/// no `work` in it -- and the break surfaces from the *linker*, as `undefined
/// reference to 'work'`, with nothing tying it to the `NTS1001` printed five
/// lines earlier.
///
/// That read as a mysterious build failure for one case and took the README
/// table down with it. Asked here instead, where the answer is "this compiler
/// refuses this program", which the table has a spelling for.
///
/// Looks for the *definition*, not the declaration: the generated C emits
/// `double work(double v0);` at the top of every file that calls it and
/// `double work(double v0) {` only where it has a body. `initializes` above
/// asks the same kind of question the same way.
fn missing_entry(text: &str, entry: &[String]) -> Option<String> {
    entry
        .iter()
        .find(|name| !text.lines().any(|line| defines(line, name)))
        .cloned()
}

/// Whether one line of generated C opens the body of `name`.
///
/// Unindented and ending in `{`, which together separate a definition from both
/// the prototype above it and any block inside another function.
///
/// The name has to be matched on a word boundary rather than after a space: a
/// `string`-returning entry is emitted `NtsString *work(...)`, with no space
/// before it, and a substring test alone would also accept `nts_work(`.
fn defines(line: &str, name: &str) -> bool {
    if !line.ends_with('{') || line.starts_with(char::is_whitespace) {
        return false;
    }
    let needle = format!("{name}(");
    let mut from = 0;
    while let Some(found) = line[from..].find(&needle) {
        let at = from + found;
        let before = line[..at].chars().next_back();
        if !matches!(before, Some(c) if c.is_alphanumeric() || c == '_') {
            return true;
        }
        from = at + 1;
    }
    false
}

fn emit(
    tsconfig: &Utf8Path,
    entry: &[String],
    specialize: bool,
    provider: hir::Memory,
    llvm: bool,
) -> Result<String> {
    let backend = if llvm {
        nts_codegen_common::Backend::Llvm
    } else {
        nts_codegen_common::Backend::C
    };
    let program = prepared_program(tsconfig, entry, specialize, provider, backend)?;
    Ok(emit_program(&program, llvm))
}

fn emit_program(program: &hir::Program, llvm: bool) -> String {
    if llvm {
        let emitted = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        return emitted.text;
    }
    let emitted = nts_codegen_c::emit(program, nts_core::hir::native::NativeAbi::LP64);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  {} {}", diagnostic.code, diagnostic.message);
    }
    emitted.writer.text().to_owned()
}

/// The middle end, run once and shared by every lane.
///
/// Split out of [`emit`] so the JVM backend gets the same program the C and
/// LLVM columns do -- including the `Roots::Entry` argument the comment below
/// exists to justify, which is the difference between measuring a benchmark and
/// measuring a library.
/// The program one backend's column measures, prepared as that backend's
/// driver prepares it: the provider, and whether its tables answer a key's
/// entry (`Backend::table_entries`), since this links the compiler directly
/// and a choice the CLI makes and this did not would be measured as nobody's.
fn prepared_program(
    tsconfig: &Utf8Path,
    entry: &[String],
    specialize: bool,
    provider: hir::Memory,
    backend: nts_codegen_common::Backend,
) -> Result<hir::Program> {
    let snapshot = capture_snapshot(tsconfig)?;
    prepare_snapshot(&snapshot, entry, specialize, provider, backend)
}

fn capture_snapshot(tsconfig: &Utf8Path) -> Result<nts_semantic_schema::SemanticSnapshot> {
    let cwd = Utf8PathBuf::from_path_buf(std::env::current_dir()?)
        .map_err(|_| anyhow::anyhow!("the benchmark directory is not UTF-8"))?;
    let snapshot = Frontend::new(cwd)
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(tsconfig)?;
    if snapshot.has_errors() {
        bail!("{tsconfig} does not typecheck");
    }
    Ok(snapshot)
}

fn prepare_snapshot(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    entry: &[String],
    specialize: bool,
    provider: hir::Memory,
    backend: nts_codegen_common::Backend,
) -> Result<hir::Program> {
    // A benchmark is an *executable* whose entry point is `work`, and an
    // executable's exports are not roots: nothing outside the program can call
    // them, because there is no outside.
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
        snapshot,
        &hir::Options {
            specialize_numbers: specialize,
            provider,
            roots: hir::reachable::Roots::Entry(entry),
            // Empty, which is what a project with only `include` has and what
            // this harness synthesises for every case. It is also what this
            // call passed before the field existed, so the columns keep
            // measuring the program they measured yesterday.
            foreign: &hir::runtime::ForeignTable::default(),
            entry_files: &[],
            // A benchmark is a standalone program on libuv's loop, which no
            // callback returns to.
            callbacks_checkpoint: false,
            targets: nts_core::hir::native::Targets::only(hir::HOST),
            table_entries: backend.table_entries(),
            // What the backend provides, for a `typeof` of an intrinsic
            // (`hir::features`): C's and LLVM's runtime header, each other
            // backend's own table.
            provided: hir::features::Provided::By(match backend {
                nts_codegen_common::Backend::C | nts_codegen_common::Backend::Llvm => {
                    nts_codegen_llvm::provides
                }
                nts_codegen_common::Backend::Jvm => nts_codegen_jvm::provides,
            }),
        },
    ) {
        Ok(prepared) => prepared,
        Err(unprepared) => bail!("{}", unprepared.render(&snapshot.sources)),
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
    libraries: &reference_link::Libraries,
) -> Result<()> {
    // What a shipped program is built with (`compile_flags::OPTIMIZE` and
    // `LTO`), for nts's code and the C++ reference alike: the same compiler and
    // the same flags on both sides of the ratio, and the same as `nts build`.
    // And the CPU a host build is for, as `nts build` takes it: on x86-64,
    // `X86_64_V3` and its loop alignment, `X86_64_LOOPS` (at the link,
    // `X86_64_LOOPS_AT_LINK`).
    let x86_64 = std::env::consts::ARCH == "x86_64";
    let (cpu, loops, loops_at_link): (&[&str], &[&str], &[&str]) = if x86_64 {
        (
            nts_codegen_common::compile_flags::X86_64_V3,
            nts_codegen_common::compile_flags::X86_64_LOOPS,
            nts_codegen_common::compile_flags::X86_64_LOOPS_AT_LINK,
        )
    } else {
        (&[], &[], &[])
    };
    let shared: Vec<&str> = nts_codegen_common::compile_flags::OPTIMIZE
        .iter()
        .chain(nts_codegen_common::compile_flags::LTO)
        .chain(cpu)
        .chain(loops)
        .copied()
        .chain(["-Wall", "-Wextra", "-Werror"])
        .collect();
    let mut includes = vec![
        "-I".to_owned(),
        root.join("benchmarks/common").to_string(),
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
                .args(&shared)
                .args(&extra)
                .args(references::warning_flags(source)?)
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
            if !output.stderr.is_empty() {
                eprint!("{}", String::from_utf8_lossy(&output.stderr));
            }
            objects.push(object);
        }
    }

    let link = std::process::Command::new("clang++")
        .args(&shared)
        .args(loops_at_link)
        .args(&objects)
        .arg("-o")
        .arg(binary)
        .arg("-lm")
        .args(libraries.flags())
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
/// **Five, because the paragraph above measured five and the constant said
/// three.** The reason and the number had drifted apart, and the drift is
/// visible in the table: `dispatch` reported 1.06, 1.24, 0.72, 1.06 and 1.05 on
/// five consecutive locked runs of the same binary. It is bimodal -- a fast
/// shape the JIT reaches about one set in five -- and a best-of-three finds it
/// that seldom, so the published ratio was a coin flip between 0.72x and 1.24x.
///
/// `checksum` reported 1.00x five times out of five in the same window, so this
/// is not ambient noise on the machine; it is which shape the JIT settles into,
/// and a "best of" estimator answers that correctly only if it looks often
/// enough to see the good one.
const RUNS: usize = 5;

/// The CPUs a timed run is allowed on, or `None` to leave it to the scheduler.
///
/// # Two arms of one comparison, measured on different hardware
///
/// This machine is an i9-14900K: eight P-cores at 5700-6000MHz and sixteen
/// E-cores at 4400. Nothing here pinned, so every row was two processes the
/// scheduler could put on either kind, and `in-narrowing` measured **1362ns
/// free, 1340 pinned to P, and 2474 pinned to E** -- the same binary, 1.8x
/// apart, which is more than the 1.295 clock ratio because the IPC differs too.
///
/// A ratio survives that only when both arms happen to land the same way. When
/// they do not, the row is wrong by up to 1.8x in whichever direction it fell,
/// and `nts-bench` reports it with a variance note rather than a reason:
/// `dispatch` varied **1.93x across five runs of one binary**, `objects` 1.17x
/// and 1.22x, `awfy-bounce` 1.41x. Those rows have been unquotable and this is
/// why.
///
/// `perf stat` is what gave it away, by answering with a `cpu_core` line and a
/// `cpu_atom` line for every event.
///
/// # Why P-cores and not "the same core either way"
///
/// Pinning both arms to E-cores would also make the ratio meaningful, and would
/// measure a machine nobody ships on. The P-cores are what a benchmark is
/// about. The measurement wrapper explicitly selects CPU 4 with sibling 5
/// idle; a default used outside it must also respect its caller's affinity.
///
/// A default is intersected with the caller's allowed set: `taskset` can
/// otherwise widen back onto the physical core reserved from a gate.
/// `NTS_BENCH_CPUS` explicitly overrides the set; `off` disables pinning.
fn timed_cpus() -> Result<Option<String>> {
    match std::env::var("NTS_BENCH_CPUS") {
        Ok(value) if value == "off" => return Ok(None),
        Ok(value) if !value.is_empty() => return Ok(Some(value)),
        _ => {}
    }
    // The kernel names the performance cores on a hybrid part. A machine that
    // is not hybrid has no such file and needs no pinning: every core is the
    // same core, which is the assumption the rest of this harness was written
    // under.
    let Ok(cpus) = std::fs::read_to_string("/sys/devices/cpu_core/cpus") else {
        return Ok(None);
    };
    let status = std::fs::read_to_string("/proc/self/status")
        .context("reading inherited affinity for the benchmark's default CPUs")?;
    let allowed = status
        .lines()
        .find_map(|line| line.strip_prefix("Cpus_allowed_list:"))
        .context("/proc/self/status names no inherited CPU set")?;
    Ok(Some(default_timed_cpus(cpus.trim(), allowed.trim())?))
}

fn default_timed_cpus(preferred: &str, inherited: &str) -> Result<String> {
    fn list(value: &str) -> Result<std::collections::BTreeSet<u32>> {
        let mut cpus = std::collections::BTreeSet::new();
        for part in value.split(',') {
            let (first, last) = part.split_once('-').unwrap_or((part, part));
            let first: u32 = first.parse().context("invalid CPU list")?;
            let last: u32 = last.parse().context("invalid CPU list")?;
            if last < first || last > 1_048_575 {
                bail!("invalid CPU range: {part}");
            }
            cpus.extend(first..=last);
        }
        Ok(cpus)
    }
    let preferred_set = list(preferred)?;
    let inherited_set = list(inherited)?;
    let cpus: Vec<_> = preferred_set
        .intersection(&inherited_set)
        .map(u32::to_string)
        .collect();
    if cpus.is_empty() {
        bail!(
            "default CPUs {preferred} have no intersection with inherited CPUs {inherited}; use NTS_BENCH_CPUS for an explicit measurement affinity"
        );
    }
    Ok(cpus.join(","))
}

/// The same command, confined to `cpus`.
///
/// Rebuilt rather than mutated because `Command` has no way to prepend a
/// program. Everything the caller set has to be carried over by hand, and the
/// environment is the part that would fail silently -- `NTS_CHECKERS` and the
/// provider variables all arrive that way.
fn confine(command: &std::process::Command, cpus: &str) -> std::process::Command {
    let mut pinned = std::process::Command::new("taskset");
    pinned.arg("-c").arg(cpus).arg(command.get_program());
    pinned.args(command.get_args());
    for (key, value) in command.get_envs() {
        match value {
            Some(value) => {
                pinned.env(key, value);
            }
            None => {
                pinned.env_remove(key);
            }
        }
    }
    if let Some(dir) = command.get_current_dir() {
        pinned.current_dir(dir);
    }
    pinned
}

fn measure(command: &mut std::process::Command) -> Result<Measured> {
    let confined = timed_cpus()?.map(|cpus| confine(command, &cpus));
    let mut owned;
    let command: &mut std::process::Command = match confined {
        Some(pinned) => {
            owned = pinned;
            &mut owned
        }
        None => command,
    };
    let mut best: Option<Measured> = None;
    let mut worst = f64::MIN;
    for _ in 0..RUNS {
        let attempt = measure_once(command)?;
        worst = worst.max(attempt.ns_per_op);
        if best
            .as_ref()
            .is_none_or(|held| attempt.ns_per_op < held.ns_per_op)
        {
            best = Some(attempt);
        }
    }
    let mut best = best.context("a benchmark produced no measurement")?;
    best.spread = if best.ns_per_op > 0.0 {
        worst / best.ns_per_op
    } else {
        1.0
    };
    Ok(best)
}

/// A run whose passes disagree by more than this has something to say about
/// itself. **What it says is not "this row has no number".**
///
/// This threshold's message used to be that such a row "reports which shape the
/// JIT settled into, not how fast the program is", and that is true of
/// `dispatch` and was written from it. Generalised to every row that trips the
/// threshold it is wrong, and it cost five rows their status:
///
///     objects                0.99x six times out of six
///     case-convert           0.92x-1.01x, median 0.955
///     awfy-bounce            0.97x-1.03x, median 0.99
///     awfy-sieve             0.92x-1.02x, median 0.94
///     number-format-double   1.15x-1.17x, a spread of 1.7%
///
/// All five carried this note and four of them were at or under 1.00x while
/// being described as unquotable. `number-format-double` never varied at all --
/// its flag was raised on the *Java* side, so a note about the reference's
/// instability was suppressing our own stable number, and that number is 1.15x
/// rather than the 1.08x it had been listed at.
///
/// **What is measured here is the spread; what is reported is the minimum, and
/// those are different claims.** A minimum can be reproducible across
/// processes while the spread around it is wide -- that is what best-of-N is
/// for. The flag should send a reader to six invocations, not away from the
/// row, and it now says so.
///
/// `dispatch` reported 1.06, 1.24, 0.72, 1.06 and 1.05 on five consecutive
/// locked runs of one binary, and 1.04, 0.71, 0.70, 1.10 on four more after
/// `RUNS` went from three to five. It is **trimodal** -- about 18, 28 and 34 us
/// -- and a best-of-N converges on none of them; it converges on *how often you
/// looked*. `checksum` reported 1.00x nine times out of nine in the same window,
/// so the machine is quiet and this is the program.
///
/// It is not the JIT, which this comment used to say it was. The compilation
/// log of a fast run and a slow one is the same methods at the same tiers in
/// the same order, down to the OSR bci. The mode is chosen once per JVM and
/// held for its life -- twelve measurement passes inside one process agree to a
/// few percent while processes differ by 1.95x.
///
/// A row like that has no single number, and printing one of the two as though
/// it were the answer is the failure this table exists to avoid. So it is said
/// out loud instead.
///
/// **1.10 rather than the 1.25 this started at, and now measured rather than
/// guessed.** Twelve rows, six locked runs each, one binary:
///
///     absences 0.0%  user-iterable 0.0%  loop 0.1%  checksum 0.1%
///     module-closures 0.4%  array-predicates 0.5%  closures 0.7%
///     arrays 1.3%  fib 0.6%  map-and-set 2.1%
///     awfy-bounce 15.1%  dispatch 23.3%
///
/// The stable rows stop at 1.021 and the modal ones start at 1.151, so the gap
/// between them is an order of magnitude wide and 1.10 sits in the middle of
/// nothing. The old 1.25 was chosen before any of this existed and let
/// `awfy-bounce` through.
///
/// Record 0132 has the rest: the modes are chosen once per JVM and held, they
/// are not warmup, compilation, SMT placement, address randomisation or
/// allocation, and the hand-written Java reference for the same row on the same
/// JVM is stable to 7.4% -- so they belong to the code this backend emits.
const SPREAD_WORTH_SAYING: f64 = 1.10;

/// What is known about a row's instability, beyond what this sitting saw.
///
/// **Two modes and one move are different claims** and the table must not
/// render them the same way. A confirmed flip says the figure is a draw from a
/// distribution; a single observed move says only that two sittings disagreed,
/// which the machine can cause on its own — four rows moved 8% or more in one
/// survey *together with their own programs*, and their ratios held to 0.02.
#[derive(Clone, Copy)]
enum Basis {
    /// Two modes seen out of one binary, repeatedly. The published figure says
    /// which mode the run landed in.
    Bimodal,
    /// Two sittings disagreed about this column and the other half of the row
    /// did not move with it. Suggestive, and not two modes until a third
    /// sitting says so.
    Moved,
}

impl Basis {
    fn shown(self) -> &'static str {
        match self {
            Self::Bimodal => "confirmed: two modes out of one binary",
            Self::Moved => "observed to move; cause unknown",
        }
    }
}

/// Rows whose instability is known from *previous* sittings, carried whether or
/// not this one sees it.
///
/// A row that flips one time in six is stable on five sittings, and on each of
/// those the table prints a bare number. `spreads` was written because "a
/// flipped row and a solid one are the same number on the page" — and it had
/// exactly that hole, because it reported only what the publishing run happened
/// to observe.
///
/// Entries are removed when a **cause** is found, not when a run comes back
/// clean: a clean run is what this table exists to disbelieve.
/// The cases this compiler is known to refuse, and why each one.
///
/// **A count rather than a condition, which is the negative arm for free.**
/// "some cases refuse" passes on 61 of 61 and on 1 of 61 alike; "exactly these
/// cases refuse" fails on both mistakes. `6047805a` is why: a refusal detector
/// that fired on *every* case in the corpus passed six unit tests, clippy and a
/// full `cargo test`, because every one of them asked whether it fires when it
/// should and none asked whether it stays quiet when it should.
///
/// So a new entry here is a regression to explain, a missing one is a fix to
/// celebrate and record, and either way the run says so rather than printing a
/// table with four quiet `--`s in it.
///
/// Empty since 2026-10-15. `json-stringify-doc`, the last entry, was refused
/// from `c9f3d3a09` (2026-09-10): a structural-to-subclass pointer cast, from
/// `stringifyJsonValue(DOCUMENT, { gap: "" })` reading `options.replacer` off
/// an anonymous type. Every surviving pinned compiler from `f35a873b4`
/// (2026-09-27) on lowers `work` under `--rc`, so the fix is in
/// `c9f3d3a09..f35a873b4`; no pin in that range survives to narrow it, and the
/// README row that still showed it refused was carried over, not re-measured.
///
/// `utf8-encode` (2026-10-22) arrived refused, and that is the finding it was
/// written to make: `new TextEncoder()` in compiled user code is "a `new` of
/// unrepresentable type", because the global is not wired to
/// `runtime/web-platform`'s `TextEncoder` -- the same gap as `JSON.stringify`.
/// The case calls the global, as a program does, and comes off this list in
/// the commit that wires it.
const REFUSES_TODAY: &[(&str, &str)] = &[(
    "utf8-encode",
    "`new TextEncoder()`: the global is not wired to runtime/web-platform's class",
)];

/// Whether the cases that refused are the cases expected to refuse.
///
/// Returns the sentence to print, or `None` when the set matches. Separate from
/// `publish` so it can be asserted rather than watched -- the same reason
/// `lost_case_decline` is.
fn refusal_drift(rows: &[Row], known: &[(&str, &str)]) -> Option<String> {
    use std::fmt::Write as _;
    let mut refused: Vec<&str> = rows
        .iter()
        .filter(|row| row.nts.is_none() && !row.outcomes.contains_key(&execution::Column::C))
        .map(|row| row.case.strip_suffix(" (rc)").unwrap_or(&row.case))
        .collect();
    refused.sort_unstable();
    let mut expected: Vec<&str> = known.iter().map(|(case, _)| *case).collect();
    expected.sort_unstable();
    if refused == expected {
        return None;
    }
    let new: Vec<&str> = refused
        .iter()
        .filter(|c| !expected.contains(c))
        .copied()
        .collect();
    let gone: Vec<&str> = expected
        .iter()
        .filter(|c| !refused.contains(c))
        .copied()
        .collect();
    let mut said = String::new();
    if !new.is_empty() {
        let _ = write!(
            said,
            "{} case(s) this compiler did not refuse before now do: {}. \
             A new refusal is a regression until something says otherwise. ",
            new.len(),
            new.join(", ")
        );
    }
    if !gone.is_empty() {
        let _ = write!(
            said,
            "{} case(s) listed as refused now compile: {}. \
             Take them out of `REFUSES_TODAY` in the commit that fixed them.",
            gone.len(),
            gone.join(", ")
        );
    }
    Some(said)
}

/// Cases whose node column measures work nts does not do at all, and what.
/// Their ratios against node are marked, and say nothing about generated code.
const KNOWN_ASYMMETRIC: &[(&str, &str)] = &[(
    "exceptions",
    "node and Java build a stack trace for every throw, which nts does not do, \
     so its ratios against them measure the trace",
)];

const KNOWN_BIMODAL: &[(&str, &str, f64, &str, Basis)] = &[
    // 5.74, 5.74 and 5.38 us on one sitting against 4.49, 4.44 and 4.48 on
    // another, out of one class file — and the *reference* is the bimodal half,
    // not us. From outside: this file publishes 0.94x where
    // `tooling/android/times-on-device.sh` reads 1.32x and 1.33x across two
    // sittings on the same machine and the same HotSpot, every other shared row
    // agreeing. The arithmetic closes on the reference's mode alone: that
    // harness measured the reference at 4359 and 4441 ns, squarely the fast
    // mode, where 0.94x needs it near 5740. Both harnesses honest, habitually
    // landing in different modes. `benchmarks/jvm-rows.md` carries the row as a
    // range rather than a number.
    // **Both halves, which took a control to find.** The reference's two modes
    // were recorded first and looked like the whole story. Then the JVM lane
    // drove *our* artefact through both harnesses, alternating, on a quiet
    // machine: they agree within 3%, so neither the timing arm nor the
    // classpath nor the driver is the fork — and our own side swings 4428 to
    // 5685 ns out of one class file, 1.28x, at what look like the same two
    // levels the reference sits at.
    //
    // So the ratio is the quotient of two independently bimodal halves and can
    // land anywhere from about 0.79x to about 1.28x with nothing wrong
    // anywhere. 0.94, 1.32 and 1.33 are all inside it.
    //
    // Two *different* programs — this compiler's output and Are We Fast Yet's
    // hand-written Java — flipping between the same two levels on one machine is
    // not about either program. The workload is a `boolean[5000]` sieve and a
    // flip that size out of one class file is the shape of a decision made once
    // per process. Named with the measurement rather than chased.
    // 1.33x across five passes of one class file on 2026-09-15, and the row
    // published 1.24x that sitting against **0.94x in two earlier ones** with
    // our own side steady. Java read 6.31us here and about 8.3us before, so the
    // reference is the moving half -- the same finding this file already
    // records for `awfy-sieve`, on a row that had never been flagged.
    //
    // Two of the eight AWFY references now behave this way, which is worth more
    // than either entry: the bar is "at or under hand-written Java", and on
    // those rows hand-written Java is not one number.
    (
        "awfy-list",
        "Java",
        1.33,
        "five passes of one binary, against two earlier sittings",
        Basis::Bimodal,
    ),
    (
        "awfy-sieve",
        "Java",
        1.27,
        "a previous sitting, and a second harness",
        Basis::Bimodal,
    ),
    (
        "awfy-sieve",
        "nts (JVM)",
        1.28,
        "a control run, both harnesses",
        Basis::Bimodal,
    ),
    // The reference got 13% and 12% faster across two sittings while our side
    // did not move — which is the `awfy-sieve` shape and smaller, and two
    // sittings are a move rather than two modes. `number-format-double` is a row
    // real effort has gone into at 1.15x and then 0.95x, and both are suspect
    // from the reference's side rather than from ours.
    (
        "number-format-double",
        "Java",
        1.13,
        "two sittings, reference only",
        Basis::Moved,
    ),
    (
        "symbol-keyed-map",
        "Java",
        1.12,
        "two sittings, reference only",
        Basis::Moved,
    ),
];

fn measure_once(command: &mut std::process::Command) -> Result<Measured> {
    let output = command.output().context("running a benchmark")?;
    if !output.status.success() {
        return Err(execution::Outcome::of(&output)?.into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut fields = text.split_whitespace();
    let ns_per_op: f64 = fields
        .next()
        .context("no timing on stdout")?
        .parse()
        .context("timing was not a number")?;
    let checksum = fields.next().context("no checksum on stdout")?.to_owned();
    // A third field only the JVM driver writes, and only when its warm-up was
    // still compiling at the cap.
    let warm_capped = fields.next() == Some("warm-capped");
    Ok(Measured {
        ns_per_op,
        checksum,
        // Filled in by `measure`, which is the only thing that sees more
        // than one pass.
        spread: 1.0,
        warm_capped,
    })
}

/// A duration a person can compare at a glance.
fn human(ns: f64) -> String {
    // A lane a filter excluded reads `--`, the same as one that refused. Both
    // mean "this run does not have a number here", and a filtered run never
    // reaches the README.
    if ns.is_nan() {
        return "--".to_owned();
    }
    if ns < 1_000.0 {
        format!("{ns:.1} ns")
    } else if ns < 1_000_000.0 {
        format!("{:.2} us", ns / 1_000.0)
    } else {
        format!("{:.2} ms", ns / 1_000_000.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        REFUSES_TODAY, Row, driver_entries, lost_case_decline, missing_entry, refusal_drift,
    };
    use anyhow::Context;
    use camino::Utf8PathBuf;

    #[test]
    fn default_measurement_cpus_never_widen_the_inherited_set() {
        assert_eq!(
            super::default_timed_cpus("0-15", "0-3,6-31").expect("intersection"),
            "0,1,2,3,6,7,8,9,10,11,12,13,14,15"
        );
        assert_eq!(
            super::default_timed_cpus("0-15", "8").expect("one CPU"),
            "8"
        );
        let error = super::default_timed_cpus("0-15", "16-31")
            .expect_err("an E-core caller needs an explicit measurement override");
        assert!(error.to_string().contains("no intersection"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_default_timed_child_keeps_the_gate_cpu_reservation() -> anyhow::Result<()> {
        if !std::path::Path::new("/sys/devices/cpu_core/cpus").exists() {
            return Ok(());
        }
        if std::env::var_os("NTS_BENCH_AFFINITY_CHILD").is_some() {
            let cpus = super::timed_cpus()?.context("a hybrid host has preferred CPUs")?;
            let mut command = std::process::Command::new("sh");
            command.args([
                "-c",
                "awk '/^Cpus_allowed_list:/ {print $2}' /proc/self/status",
            ]);
            let child = super::confine(&command, &cpus).output()?;
            assert!(child.status.success());
            let actual = String::from_utf8(child.stdout)?;
            let expected = super::default_timed_cpus("0-15", "0-3,6-31")?;
            assert_eq!(super::default_timed_cpus("0-31", actual.trim())?, expected);
            // An explicit measurement request remains distinct from a default.
            // Check its spelling without occupying the reserved core in a test.
            let explicit = std::process::Command::new(std::env::current_exe()?)
                .args(["--exact", "tests::an_explicit_measurement_cpu_is_kept"])
                .env("NTS_BENCH_CPUS", "4")
                .status()?;
            assert!(explicit.success());
            return Ok(());
        }
        let child = std::process::Command::new("taskset")
            .args(["-c", "0-3,6-31"])
            .arg(std::env::current_exe()?)
            .args([
                "--exact",
                "tests::a_default_timed_child_keeps_the_gate_cpu_reservation",
                "--nocapture",
            ])
            .env_remove("NTS_BENCH_CPUS")
            .env("NTS_BENCH_AFFINITY_CHILD", "1")
            .output()?;
        assert!(
            child.status.success(),
            "{}{}",
            String::from_utf8_lossy(&child.stdout),
            String::from_utf8_lossy(&child.stderr)
        );
        Ok(())
    }

    #[test]
    fn an_explicit_measurement_cpu_is_kept() {
        if std::env::var("NTS_BENCH_CPUS").as_deref() == Ok("4") {
            assert_eq!(
                super::timed_cpus().expect("explicit CPU"),
                Some("4".to_owned())
            );
        }
    }

    fn row(case: &str) -> Row {
        Row {
            case: case.to_owned(),
            cpp: None,
            cpp_absence: None,
            outcomes: std::collections::BTreeMap::new(),
            nts: Some(1.0),
            unspecialized: Some(1.0),
            node: 1.0,
            llvm: None,
            jvm: None,
            jvm_absence: None,
            java: None,
            bun: None,
            varied: Vec::new(),
        }
    }

    fn refused_row(case: &str) -> Row {
        Row {
            nts: None,
            unspecialized: None,
            ..row(case)
        }
    }

    /// A refusal the tests list, so every arm below is exercised whether or not
    /// `REFUSES_TODAY` has an entry today.
    const KNOWN: &[(&str, &str)] = &[("json-stringify-doc", "for the tests")];

    #[test]
    fn exceptions_says_whose_trace_its_node_ratio_measures() {
        assert!(row("exceptions").asymmetry().is_some());
        assert!(row("fib").asymmetry().is_none());
    }

    fn measured(ns: f64) -> super::Measured {
        super::Measured {
            ns_per_op: ns,
            checksum: "3ff0000000000000".to_owned(),
            spread: 1.0,
            warm_capped: false,
        }
    }

    #[test]
    fn runtime_abort_keeps_independent_columns_and_cells() -> anyhow::Result<()> {
        use super::execution::{Column, Outcome, Termination};
        let abort = Outcome::RuntimeAbort {
            termination: Termination::Signal { signal: 6 },
            stderr: "nts: refused: index 7 is outside [0, 1)\n".to_owned(),
        };
        let mut observation = super::Measurements {
            workload: None,
            shown: "runtime-abort-control".to_owned(),
            results: vec![None, None, Some(measured(10.0)), None, None, None],
            absences: super::Absences {
                jvm: Some(super::JvmAbsence::RuntimeAbort),
                cpp: None,
                outcomes: [Column::C, Column::F64, Column::Llvm, Column::Jvm]
                    .into_iter()
                    .map(|column| (column, abort.clone()))
                    .collect(),
            },
            lowers: true,
            node: measured(20.0),
            bun: Some(measured(19.0)),
        };
        // The saved run retains the typed observation and all independent work.
        let saved = serde_json::to_string(&observation)?;
        let reread: super::Measurements = serde_json::from_str(&saved)?;
        let row = super::assemble(&reread, false)?;
        assert_eq!(row.cpp, Some(10.0));
        assert_eq!(row.bun, Some(19.0));
        assert!(row.nts.is_none());
        assert_eq!(row.outcomes.get(&Column::C), Some(&abort));
        assert_eq!(
            super::refusal_drift(std::slice::from_ref(&row), &[]),
            None,
            "a runtime abort is distinct from a compile refusal"
        );
        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../../target/bench-abort-cells-{}",
            std::process::id()
        ));
        super::results::record(
            &root,
            &[row],
            &super::results::Run {
                measured: "test".to_owned(),
                commit: "test".to_owned(),
                lanes: None,
                spoiled: &[],
            },
        )?;
        let cells = std::fs::read_to_string(root.join("results/benchmarks/cells.tsv"))?;
        let native = cells
            .lines()
            .find(|line| line.contains("\tnts_c\t"))
            .context("missing native cell")?;
        let fields: Vec<_> = native.split('\t').collect();
        assert_eq!(fields[2], "aborted");
        assert_eq!(
            serde_json::from_str::<Option<Outcome>>(fields[6])?,
            Some(abort)
        );
        assert!(cells.lines().any(|line| line.contains("\tnode\t20.0\t")));
        assert!(cells.lines().any(|line| line.contains("\tcpp\t10.0\t")));
        // Missing timings cannot hide a disagreement between columns that ran.
        observation.results[2]
            .as_mut()
            .expect("C++ observation")
            .checksum = "different".to_owned();
        assert!(super::assemble(&observation, false).is_err());
        observation.results[0] = Some(measured(1.0));
        assert!(
            super::assemble(&observation, false)
                .err()
                .context("contradictory observation was accepted")?
                .to_string()
                .contains("both a runtime abort and a timing")
        );
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    /// A saved run assembles the rows it assembled when it was measured: the
    /// measurements survive the round trip through `run.json`.
    #[test]
    fn a_saved_run_assembles_the_same_rows() {
        let measurements = super::Measurements {
            workload: None,
            shown: "fib".to_owned(),
            results: vec![
                Some(measured(10.0)),
                Some(measured(12.0)),
                Some(measured(9.0)),
                Some(measured(10.5)),
            ],
            absences: super::Absences {
                outcomes: std::collections::BTreeMap::new(),
                jvm: Some(super::JvmAbsence::NotRun),
                cpp: None,
            },
            lowers: true,
            node: measured(30.0),
            bun: None,
        };
        let fresh = super::assemble(&measurements, false).expect("a row");
        let text = serde_json::to_string(&measurements).expect("saved");
        let saved: super::Measurements = serde_json::from_str(&text).expect("read back");
        let again = super::assemble(&saved, false).expect("the same row");
        assert_eq!(
            (fresh.nts, fresh.cpp, fresh.llvm, fresh.node),
            (again.nts, again.cpp, again.llvm, again.node)
        );
        assert_eq!(again.nts, Some(10.0));
        assert!(matches!(again.jvm_absence, Some(super::JvmAbsence::NotRun)));
    }

    #[test]
    fn missing_optional_cpp_library_keeps_a_valid_row_and_its_reason() {
        let absent = "optional C++ libraries unavailable: missing; C++ column is --";
        let measurements = super::Measurements {
            workload: None,
            shown: "optional-link-control".to_owned(),
            results: vec![
                Some(measured(1.0)),
                Some(measured(1.0)),
                None,
                Some(measured(1.0)),
            ],
            absences: super::Absences {
                outcomes: std::collections::BTreeMap::new(),
                jvm: None,
                cpp: Some(absent.to_owned()),
            },
            lowers: true,
            node: measured(1.0),
            bun: Some(measured(1.0)),
        };
        let json = serde_json::to_string(&measurements).expect("valid missing-reference row");
        let restored = serde_json::from_str(&json).expect("valid missing-reference row");
        let row = super::assemble(&restored, false).expect("valid missing-reference row");
        assert!(row.cpp.is_none());
        assert_eq!(row.cpp_absence.as_deref(), Some(absent));
        assert_eq!(row.nts, Some(1.0));
        assert_eq!(row.node, 1.0);
        assert_eq!(row.bun, Some(1.0));
        super::work_agrees(&row).expect("valid missing-reference row");
    }

    #[test]
    fn a_rejected_work_row_survives_in_json_and_fails_finish_and_render() {
        for rejected in [true, false] {
            let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .expect("UTF-8 temporary directory")
                .join(format!(
                    "nts-bench-rejection-{}-{rejected}",
                    std::process::id()
                ));
            std::fs::create_dir_all(root.join("target/bench")).expect("output directory");
            std::fs::create_dir_all(root.join("results/benchmarks")).expect("results directory");
            let table = root.join("results/benchmarks/full.md");
            std::fs::write(&table, "old table\n").expect("old full table");
            let measurements = super::Measurements {
                workload: None,
                shown: "work-guard-control".to_owned(),
                results: vec![
                    Some(measured(1.5)),
                    Some(measured(10.0)),
                    None,
                    Some(measured(1.5)),
                    Some(measured(if rejected { 11_000.0 } else { 2.0 })),
                ],
                absences: super::Absences {
                    outcomes: std::collections::BTreeMap::new(),
                    jvm: None,
                    cpp: None,
                },
                lowers: true,
                node: measured(30.0),
                bun: None,
            };
            let mut failed = Vec::new();
            let rows: Vec<_> = super::accept_result(
                &measurements.shown,
                super::assemble(&measurements, false),
                &mut failed,
            )
            .into_iter()
            .collect();
            let run = super::Run {
                lanes: None,
                requested: vec![measurements.shown.clone()],
                cases: vec![measurements.shown.clone()],
                spoiled: Vec::new(),
                failed,
                measured: vec![measurements],
            };
            let cases = vec![root.join("benchmarks/cases/work-guard-control")];
            let result = super::finish(&root, &run, &rows, &cases);
            assert_eq!(result.is_err(), rejected);
            if let Err(error) = result {
                assert!(
                    error.to_string().contains("this compiler's backends"),
                    "{error:#}"
                );
            }
            let saved = super::run_file(&root);
            let text = std::fs::read_to_string(&saved).expect("failed run still saved");
            let restored: super::Run = serde_json::from_str(&text).expect("saved run");
            assert_eq!(restored.failed.len(), usize::from(rejected));
            assert_eq!(
                restored.measured.len(),
                1,
                "raw rejected measurements survive"
            );
            let rendered = super::render(&root, &saved);
            assert_eq!(rendered.is_err(), rejected);
            if let Err(error) = rendered {
                assert!(error.to_string().starts_with("1 benchmark case(s) failed:"));
            }
            // Runs saved by the old runner have no failed field. Reassembly
            // must catch their rejected work too, rather than trusting it.
            let mut old: serde_json::Value = serde_json::from_str(&text).expect("JSON");
            old.as_object_mut().expect("object").remove("failed");
            std::fs::write(&saved, serde_json::to_string(&old).expect("old JSON"))
                .expect("old run");
            assert_eq!(super::render(&root, &saved).is_err(), rejected);
            assert_eq!(
                std::fs::read_to_string(&table).expect("full table"),
                "old table\n"
            );
            std::fs::remove_dir_all(&root).expect("cleaned up");
        }
    }

    #[test]
    fn an_unmeasured_build_failure_also_fails_the_run() {
        let mut failed = Vec::new();
        assert!(
            super::accept_result::<()>(
                "broken-build",
                Err(anyhow::anyhow!("compiler failed")),
                &mut failed,
            )
            .is_none()
        );
        let error = super::require_valid_rows(&failed).expect_err("no silent success");
        assert!(error.to_string().contains("broken-build"));
    }

    /// A run of some lanes never reaches the full table, over every case as
    /// over a few.
    #[test]
    fn a_lane_filtered_run_leaves_the_full_table_alone() {
        let root = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("a UTF-8 temporary directory")
            .join(format!("nts-bench-lanes-{}", std::process::id()));
        let table = root.join("results/benchmarks/full.md");
        std::fs::create_dir_all(table.parent().expect("a directory")).expect("a root");
        std::fs::write(&table, "old\n").expect("a table");
        let rows = vec![row("fib")];
        let cases = vec![root.join("benchmarks/cases/fib")];
        super::publish(&root, &rows, &cases, &[], &[], Some(&["c".to_owned()]))
            .expect("declines quietly");
        let after = std::fs::read_to_string(&table).expect("still there");
        std::fs::remove_dir_all(&root).expect("cleaned up");
        assert_eq!(after, "old\n");
    }

    /// The set that matches is the only quiet answer.
    #[test]
    fn the_expected_refusals_are_not_drift() {
        let rows: Vec<Row> = KNOWN.iter().map(|(case, _)| refused_row(case)).collect();
        assert_eq!(refusal_drift(&rows, KNOWN), None);
        let mut today: Vec<Row> = REFUSES_TODAY
            .iter()
            .map(|(case, _)| refused_row(case))
            .collect();
        today.push(row("fib"));
        assert_eq!(refusal_drift(&today, REFUSES_TODAY), None);
    }

    /// A case that starts refusing is a regression, and is named.
    #[test]
    fn a_new_refusal_is_named_as_a_regression() {
        let mut rows: Vec<Row> = KNOWN.iter().map(|(case, _)| refused_row(case)).collect();
        rows.push(refused_row("awfy-bounce"));
        let said = refusal_drift(&rows, KNOWN).expect("a new refusal is drift");
        assert!(said.contains("awfy-bounce"), "{said}");
        assert!(said.contains("regression"), "{said}");
    }

    /// And one that stops refusing has to come off the list, so the list cannot
    /// quietly become a description of the past.
    #[test]
    fn a_case_that_now_compiles_is_named_too() {
        let said = refusal_drift(&[row("fib")], KNOWN).expect("an empty refusal set is drift");
        assert!(said.contains("json-stringify-doc"), "{said}");
        assert!(said.contains("now compile"), "{said}");
    }

    /// **The count is the point.** A detector that fires on everything passes
    /// "some cases refuse"; this is the assertion that catches it, and it is
    /// the shape `6047805a` shipped without.
    #[test]
    fn every_case_refusing_is_drift_not_success() {
        let rows: Vec<Row> = ["absences", "accumulate", "array-from", "json-stringify-doc"]
            .iter()
            .map(|case| refused_row(case))
            .collect();
        let said = refusal_drift(&rows, KNOWN).expect("61 of 61 refusing is not a pass");
        assert!(said.contains("absences"), "{said}");
        assert!(said.contains("accumulate"), "{said}");
    }

    fn cases(names: &[&str]) -> Vec<Utf8PathBuf> {
        names
            .iter()
            .map(|name| Utf8PathBuf::from(format!("/benches/cases/{name}")))
            .collect()
    }

    /// The line the silent branch did not print, asserted rather than watched.
    ///
    /// This is the shape of 2026-09-15: a full sweep, one case lost to a
    /// lowering refusal, and a `publish` that returned without a word.
    #[test]
    fn a_lost_case_is_named_in_the_decline() {
        let message = lost_case_decline(
            &[row("fib"), row("objects (rc)")],
            &cases(&["fib", "objects", "json-stringify-doc"]),
        );
        assert!(
            message.contains("json-stringify-doc"),
            "the lost case has to be named, not counted: {message}"
        );
        assert!(message.contains("1 of 3"), "{message}");
        // The two that *were* measured must not be reported lost -- and
        // `objects` is the one that proves the `(rc)` suffix is handled, since
        // its row is spelled `objects (rc)` and its directory is `objects`.
        assert!(!message.contains("objects"), "{message}");
        assert!(!message.contains("fib"), "{message}");
    }

    /// The shape that took the README table down: a declaration and no body.
    ///
    /// This is `json-stringify-doc`'s generated C exactly -- lowering refused the
    /// function, `emit-c` exited zero, the prototype stayed because the driver
    /// is emitted from the same entry list, and the first thing to notice was
    /// the linker.
    #[test]
    fn a_declared_but_undefined_entry_is_a_refusal() {
        let entry = vec!["work".to_owned()];
        let defined = "#include <stdint.h>\ndouble work(double v0);\ndouble work(double v0) {\n  return v0;\n}\n";
        let declared_only = "#include <stdint.h>\ndouble work(double v0);\n";
        assert_eq!(
            missing_entry(defined, &entry),
            None,
            "a body is a definition"
        );
        assert_eq!(
            missing_entry(declared_only, &entry),
            Some("work".to_owned()),
            "a prototype alone is not"
        );
    }

    /// A body is a body wherever the entry list points, and an *indented* line
    /// ending in `{` is a block inside some other function, not a definition.
    #[test]
    fn a_nested_block_is_not_a_definition() {
        let entry = vec!["work".to_owned()];
        // The line has to be one the guard actually decides: indented, ending
        // in `{`, and naming `work`. The first version of this fixture had no
        // such line -- it passed with the indentation check removed, which is a
        // test whose answer did not depend on the thing it was testing.
        let nested = "double other(double v) {\n  if (work(v)) {\n    return 1;\n  }\n}\n";
        assert_eq!(
            missing_entry(nested, &entry),
            Some("work".to_owned()),
            "a call to `work` inside another function does not define it"
        );
    }

    /// The negative control this change shipped without, and the bug it hid.
    ///
    /// `entry_points` appends `MODULE_INIT`, whose C spelling is
    /// `module__init`, so asking `missing_entry` for a definition of
    /// `module#init(` finds none and calls every case in the corpus refused.
    /// A full sweep reported it on `absences`, `accumulate` and `array-from`
    /// before anyone looked.
    #[test]
    fn the_module_init_root_is_not_a_driver_entry() {
        let entry = vec![
            "work".to_owned(),
            nts_core::hir::lower::MODULE_INIT.to_owned(),
        ];
        assert_eq!(driver_entries(&entry), vec!["work".to_owned()]);

        // And the whole question, asked the way `run_case` asks it: a healthy
        // program is not refused.
        let healthy = "double work(double v0);\ndouble work(double v0) {\n  return v0;\n}\nvoid module__init(void) {\n}\n";
        assert_eq!(missing_entry(healthy, &driver_entries(&entry)), None);
        assert_eq!(
            missing_entry(healthy, &entry),
            Some(nts_core::hir::lower::MODULE_INIT.to_owned()),
            "unfiltered, the root itself reads as a refusal -- which is the bug"
        );
    }

    /// The two shapes a naive substring test gets wrong.
    #[test]
    fn a_pointer_return_defines_and_a_longer_name_does_not() {
        let entry = vec!["work".to_owned()];
        let pointer = "NtsString *work(double v0) {\n  return 0;\n}\n";
        assert_eq!(
            missing_entry(pointer, &entry),
            None,
            "no space before the name"
        );
        let lookalike = "double nts_work(double v0) {\n  return v0;\n}\n";
        assert_eq!(
            missing_entry(lookalike, &entry),
            Some("work".to_owned()),
            "`nts_work` is not `work`"
        );
    }

    /// A sweep that lost nothing never reaches this branch; if it somehow does,
    /// the message must not claim a clean run declined for a named case.
    #[test]
    fn nothing_lost_says_so_rather_than_naming_a_case() {
        let message = lost_case_decline(&[row("fib")], &cases(&["fib"]));
        assert!(message.contains("0 of 1"), "{message}");
        assert!(message.contains("bug in this function"), "{message}");
    }
}
