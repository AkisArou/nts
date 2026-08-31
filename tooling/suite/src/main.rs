//! The correctness suites: how much real TypeScript this compiler survives, and
//! what is stopping the rest.
//!
//! # Why a corpus and not more tests
//!
//! Every test in this workspace was written by whoever wrote the code under it,
//! which means the suite covers what that person thought of. A corpus of
//! TypeScript written by other people, for other reasons, answers two questions
//! nothing else can:
//!
//! - **Does the compiler survive it?** A panic or an SSA-verifier rejection on
//!   arbitrary input is a bug however well the hand-written tests do. This
//!   number must stay at zero, and it only means something measured against
//!   code nobody wrote for us.
//! - **What is actually stopping us?** A refusal histogram over real files is a
//!   work queue ordered by evidence rather than by intuition. The first run put
//!   union-typed parameters and module-scope names at the top, ahead of things
//!   that felt more urgent.
//!
//! It is deliberately *not* a correctness oracle. These files are checked for
//! types, not answers. `nts check` is the oracle, and pointing it at this corpus
//! is what turns the two into one.
//!
//! # The vendored corpus
//!
//! `third_party/typescript-go/testdata/tests/cases` comes with the frontend's
//! submodule. It is a few hundred files, which is enough to build against and
//! enough to be useful; the full TypeScript corpus is another submodule deeper
//! and is worth pulling once this is a nightly rather than a command.
//!
//! Multi-file cases are skipped. They use `// @filename:` directives that mean
//! something to the TypeScript test harness and nothing here, and treating one
//! as a single file compiles a concatenation nobody wrote.

use std::fmt::Write as _;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use rustc_hash::FxHashMap;

mod test262;

/// What happened to one file.
enum Outcome {
    /// Lowered completely: every construct in it is supported.
    Lowered,
    /// Lowered in part. Carries what was refused.
    Refused(Vec<String>),
    /// The typechecker rejected it, which for a corpus of compiler tests is
    /// usually the point of the file rather than a failure.
    Rejected,
    /// The *frontend* failed: a transport error, or a query tsgo could not
    /// answer. Always a bug, and counted apart from a typecheck rejection
    /// because the two look identical from here and mean opposite things --
    /// one is the corpus working as intended and the other is this compiler
    /// falling over. Folding them together hid a real regression once.
    Failed(String),
    /// Lowering produced HIR the verifier rejected. Always a bug.
    Invalid,
}

struct Totals {
    lowered: usize,
    refused: usize,
    rejected: usize,
    failed: usize,
    invalid: usize,
    /// Programs whose generated C does not compile.
    ///
    /// A second thing that must stay at zero, and a different failure from
    /// invalid HIR: the IR can be well formed and the C still not be. `"" + n`
    /// emitted a cast from a `double` to a pointer, and the corpus called it a
    /// clean run because it never asked clang.
    uncompilable: usize,
    reasons: FxHashMap<String, usize>,
}

fn main() -> Result<()> {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .context("locating the repository root")?;

    let limit = std::env::args()
        .skip_while(|arg| arg != "--limit")
        .nth(1)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(usize::MAX);

    if std::env::args().any(|arg| arg == "test262") {
        return numeric(&root);
    }

    let corpus = root.join("third_party/typescript-go/testdata/tests/cases");
    if !corpus.is_dir() {
        bail!("no corpus at {corpus}; the typescript-go submodule is not checked out");
    }

    let mut files: Vec<Utf8PathBuf> = Vec::new();
    collect(&corpus, &mut files)?;
    files.sort();

    let totals = run(&root, &files, limit)?;
    report(&totals);
    write_readme(&root, &totals)?;
    println!("\nREADME updated.");
    Ok(())
}

/// The numeric slice of test262, compared against node.
fn numeric(root: &Utf8Path) -> Result<()> {
    let corpus = root.join("third_party/test262/test");
    if !corpus.is_dir() {
        bail!("no test262 at {corpus}; see the clone command in .gitignore");
    }
    let findings = test262::run(root, &corpus)?;
    println!("\n{} files scanned", findings.files);
    println!("  expressions taken      {}", findings.extracted);
    println!("  expressions skipped    {}", findings.skipped);
    println!("  cases compared         {}", findings.checked);
    println!("  refused by lowering    {}", findings.refused);
    println!("  disagreements          {}", findings.disagreements.len());
    for (native, engine) in findings.disagreements.iter().take(30) {
        println!("    nts  {native}");
        println!("    node {engine}");
    }
    write_test262_readme(root, &findings)?;
    println!("\nREADME updated.");
    Ok(())
}

fn write_test262_readme(root: &Utf8Path, findings: &test262::Findings) -> Result<()> {
    const START: &str = "<!-- test262:start -->";
    const END: &str = "<!-- test262:end -->";

    let mut out = String::new();
    let _ = writeln!(
        out,
        "Expressions taken from test262's `Math`, `Number` and operator tests, \
         compiled and compared against node. The expected values in those files \
         are deliberately *not* used: node is the oracle, which is a better one, \
         and it means the harness those files need is not needed here.\n"
    );
    out.push_str(
        "| | |
| --- | ---: |
",
    );
    let _ = writeln!(out, "| files scanned | {} |", findings.files);
    let _ = writeln!(out, "| expressions taken | {} |", findings.extracted);
    let _ = writeln!(
        out,
        "| expressions skipped (not yet expressible) | {} |",
        findings.skipped
    );
    let _ = writeln!(out, "| cases compared | **{}** |", findings.checked);
    let _ = writeln!(out, "| refused by lowering | {} |", findings.refused);
    let _ = writeln!(
        out,
        "| **disagreements with node** | **{}** |",
        findings.disagreements.len()
    );
    out.push_str(
        "\nMost of these are constant expressions, which means what runs on the \
         native side is a value this compiler folded at compile time. That makes \
         this a test of the abstract semantics in `hir::facts` against a real \
         engine — which is where `Math.round` near 2^53 turned out to be wrong \
         in the folder and the runtime both.\n",
    );

    let path = root.join("README.md");
    let text = std::fs::read_to_string(&path)?;
    let (Some(from), Some(to)) = (text.find(START), text.find(END)) else {
        bail!("README.md has no test262 markers");
    };
    std::fs::write(
        &path,
        format!("{}{START}\n{out}{}", &text[..from], &text[to..]),
    )?;
    Ok(())
}

/// Every `.ts` and `.tsx` beneath a directory.
fn collect(dir: &Utf8Path, into: &mut Vec<Utf8PathBuf>) -> Result<()> {
    collect_with(dir, into, "ts")?;
    collect_with(dir, into, "tsx")
}

/// Every file with one extension beneath a directory.
pub fn collect_with(dir: &Utf8Path, into: &mut Vec<Utf8PathBuf>, extension: &str) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {dir}"))? {
        let path = Utf8PathBuf::from_path_buf(entry?.path())
            .map_err(|path| anyhow::anyhow!("not utf-8: {}", path.display()))?;
        if path.is_dir() {
            collect_with(&path, into, extension)?;
        } else if path.extension() == Some(extension) {
            into.push(path);
        }
    }
    Ok(())
}

/// Where one worker does its work.
///
/// One per worker rather than one per case: a fresh directory per file would
/// spend more time in the filesystem than in the compiler, and a single shared
/// one is what kept this serial -- every case rewrites `src/main.ts`, so two at
/// once would compile each other's input.
struct Workspace {
    src: Utf8PathBuf,
    built: Utf8PathBuf,
    tsconfig: Utf8PathBuf,
}

impl Workspace {
    fn open(root: &Utf8Path, worker: usize) -> Result<Self> {
        let work = root.join(format!("target/suite/w{worker}"));
        let src = work.join("src");
        let built = work.join("c");
        std::fs::create_dir_all(&src)?;
        std::fs::create_dir_all(&built)?;
        let tsconfig = work.join("tsconfig.json");
        std::fs::write(
            &tsconfig,
            r#"{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true }, "include": ["src"] }"#,
        )?;
        Ok(Self {
            src,
            built,
            tsconfig,
        })
    }
}

/// What one file turned out to be, and anything worth saying about it.
///
/// The notes are carried rather than printed where they are found: the workers
/// finish in whatever order they finish, and a gate whose output depends on
/// scheduling is a gate nobody can diff. They are printed in file order below.
struct Examined {
    outcome: Outcome,
    notes: Vec<String>,
    uncompilable: bool,
}

/// One corpus file, start to finish.
fn examine(file: &Utf8Path, workspace: &Workspace, tsgo: &str) -> Examined {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let target = workspace.src.join(if file.extension() == Some("tsx") {
        "main.tsx"
    } else {
        "main.ts"
    });
    // Only one of the two may exist, or the compilation has two entry points.
    let _ = std::fs::remove_file(workspace.src.join("main.ts"));
    let _ = std::fs::remove_file(workspace.src.join("main.tsx"));
    if std::fs::write(&target, &text).is_err() {
        return Examined {
            outcome: Outcome::Failed("could not write the case".to_owned()),
            notes: Vec::new(),
            uncompilable: false,
        };
    }

    let mut notes = Vec::new();
    let mut uncompilable = false;

    // A fresh frontend per file. Sharing one would be faster and would also
    // share whatever state a pathological input leaves behind, and the point of
    // a corpus is that some of these inputs are pathological.
    let mut source = TsgoApi::for_compilation(tsgo.to_owned());
    // The conservation law is enforced in the lowering rather than measured
    // here: `hir::lower` refuses every function neither walk reached, which is
    // why it shows up as an ordinary refusal in the histogram. Asking again at
    // *this* point would be wrong -- `prepare` has run dead-code elimination by
    // now, and a function that was lowered and then legitimately removed looks
    // exactly like one that vanished.
    let outcome = match source.snapshot(&workspace.tsconfig) {
        Err(error) => Outcome::Failed(error.to_string()),
        Ok(snapshot) if snapshot.has_errors() => Outcome::Rejected,
        Ok(snapshot) => match hir::prepare(&snapshot) {
            Err(_) => Outcome::Invalid,
            Ok(prepared) => {
                // Ask clang whether what the backend produced is C. The IR being
                // well formed does not make the output well formed, and nothing
                // else here would notice.
                // A backend *refusal* is not malformed output. It named a
                // construct and emitted nothing, which is what every other
                // refusal does; counting it here made `uncompilable C` a number
                // with two different things in it, and a number is only worth
                // ratcheting if everything in it is what the number is named
                // after.
                match nts_differential::compiles(&prepared.program, &workspace.built) {
                    Ok(()) => {}
                    Err(nts_differential::NotC::Refused(what)) => {
                        notes.push(format!("BACKEND REFUSED: {file}: {what}"));
                    }
                    Err(nts_differential::NotC::Rejected(error)) => {
                        uncompilable = true;
                        notes.push(format!("UNCOMPILABLE C: {file}: {error}"));
                    }
                }
                if prepared.diagnostics.is_empty() {
                    Outcome::Lowered
                } else {
                    Outcome::Refused(
                        prepared
                            .diagnostics
                            .iter()
                            .map(|diagnostic| shorten(&diagnostic.message))
                            .collect(),
                    )
                }
            }
        },
    };

    Examined {
        outcome,
        notes,
        uncompilable,
    }
}

/// How many files to examine at once.
///
/// Every case is an independent subprocess tree -- a frontend, then clang -- so
/// this is the one place the machine's size shows. It took the corpus from
/// thirty seconds to four.
///
/// Capped low, and the cap is empirical rather than derived. What breaks first
/// is not this process (it peaks at 145MB whatever the worker count) but the
/// *frontends*, which are separate processes holding a type graph each: at
/// thirty-two and at sixteen, one of them died inside Go's collector and the
/// run reported `io error talking to tsgo` and one extra frontend failure. At
/// eight it did not, twice. A gate that is fast and occasionally wrong is worth
/// less than one that is slow and never is.
///
/// So eight is a floor under a machine's core count rather than a measurement
/// of anything, and `NTS_SUITE_JOBS` is there for a machine that differs. If
/// the frontend stops falling over under concurrency, this cap should go.
const CROWDED: usize = 8;

fn workers(files: usize) -> usize {
    let cores = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    std::env::var("NTS_SUITE_JOBS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|jobs| *jobs > 0)
        .unwrap_or_else(|| cores.min(CROWDED))
        // Spawning thirty-two workers for eleven files is thirty-one frontends
        // started to do nothing.
        .min(files.max(1))
}

fn run(root: &Utf8Path, files: &[Utf8PathBuf], limit: usize) -> Result<Totals> {
    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());

    // A multi-file case, which this harness has one workspace per worker for
    // and therefore cannot express. Filtered before the limit is applied so
    // that `--limit 25` means twenty-five examined rather than twenty-five
    // considered.
    let files: Vec<&Utf8PathBuf> = files
        .iter()
        .filter(|file| {
            !std::fs::read_to_string(file)
                .unwrap_or_default()
                .contains("@filename")
        })
        .take(limit)
        .collect();

    let workers = workers(files.len());
    let done = std::sync::atomic::AtomicUsize::new(0);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results: Vec<std::sync::Mutex<Option<Examined>>> =
        (0..files.len()).map(|_| std::sync::Mutex::new(None)).collect();

    std::thread::scope(|scope| -> Result<()> {
        let mut handles = Vec::new();
        for worker in 0..workers {
            let workspace = Workspace::open(root, worker)?;
            let (files, results, done, next, tsgo) =
                (&files, &results, &done, &next, tsgo.as_str());
            handles.push(scope.spawn(move || {
                loop {
                    let at = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(file) = files.get(at) else {
                        return;
                    };
                    let examined = examine(file, &workspace, tsgo);
                    *results[at].lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                        Some(examined);
                    let count = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if count % 25 == 0 {
                        println!("  {count} files...");
                    }
                }
            }));
        }
        for handle in handles {
            handle.join().map_err(|_| anyhow::anyhow!("a worker panicked"))?;
        }
        Ok(())
    })?;

    // Folded in file order, so the output of a run does not depend on which
    // worker got there first.
    let mut totals = Totals {
        lowered: 0,
        refused: 0,
        rejected: 0,
        failed: 0,
        invalid: 0,
        uncompilable: 0,
        reasons: FxHashMap::default(),
    };
    for (at, slot) in results.into_iter().enumerate() {
        let Some(examined) = slot.into_inner().unwrap_or_else(std::sync::PoisonError::into_inner) else {
            continue;
        };
        for note in examined.notes {
            println!("{note}");
        }
        if examined.uncompilable {
            totals.uncompilable += 1;
        }
        match examined.outcome {
            Outcome::Lowered => totals.lowered += 1,
            Outcome::Rejected => totals.rejected += 1,
            Outcome::Failed(error) => {
                totals.failed += 1;
                println!("FRONTEND FAILED: {}: {error}", files[at]);
            }
            Outcome::Invalid => {
                totals.invalid += 1;
                println!("INVALID HIR: {}", files[at]);
            }
            Outcome::Refused(reasons) => {
                totals.refused += 1;
                for reason in reasons {
                    *totals.reasons.entry(reason).or_default() += 1;
                }
            }
        }
    }
    Ok(totals)
}

/// A refusal message with the boilerplate taken off.
fn shorten(message: &str) -> String {
    message
        .trim_end_matches(" is not supported by this lowering yet")
        .to_owned()
}

fn report(totals: &Totals) {
    let attempted =
        totals.lowered + totals.refused + totals.rejected + totals.failed + totals.invalid;
    println!("\n{attempted} single-file cases");
    println!("  lowered completely      {}", totals.lowered);
    println!("  refused a construct     {}", totals.refused);
    println!("  rejected by typecheck   {}", totals.rejected);
    println!("  frontend failed         {}", totals.failed);
    println!("  invalid HIR             {}", totals.invalid);
    // Counted since it was added and never printed, which is the same as not
    // counting it: the two rows that must stay at zero are only a gate if a
    // reader can see both.
    println!("  uncompilable C          {}", totals.uncompilable);

    let mut reasons: Vec<(&String, &usize)> = totals.reasons.iter().collect();
    reasons.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    println!("\ntop refusals:");
    for (reason, count) in reasons.iter().take(60) {
        println!("  {count:4}  {reason}");
    }
}

fn write_readme(root: &Utf8Path, totals: &Totals) -> Result<()> {
    const START: &str = "<!-- corpus:start -->";
    const END: &str = "<!-- corpus:end -->";

    let attempted =
        totals.lowered + totals.refused + totals.rejected + totals.failed + totals.invalid;
    let considered = totals.lowered + totals.refused;
    // Percentages of a few hundred files: integer arithmetic says it exactly and
    // says it without a cast anyone has to think about.
    let share = (totals.lowered * 100).checked_div(considered).unwrap_or(0);

    let mut out = String::new();
    let _ = writeln!(
        out,
        "{attempted} single-file cases from TypeScript's own test suite, compiled \
         as ordinary programs.\n"
    );
    out.push_str("| outcome | files |\n| --- | ---: |\n");
    let _ = writeln!(out, "| lowered completely | **{}** |", totals.lowered);
    let _ = writeln!(out, "| refused a construct | {} |", totals.refused);
    let _ = writeln!(out, "| rejected by the typechecker | {} |", totals.rejected);
    let _ = writeln!(
        out,
        "| **the frontend fell over** | **{}** |",
        totals.failed
    );
    let _ = writeln!(
        out,
        "| **invalid HIR or a panic** | **{}** |",
        totals.invalid
    );
    let _ = writeln!(
        out,
        "\nOf the {considered} that typecheck, **{share}%** lower completely. \
         The typechecker rejects the rest by design — a compiler's test suite is \
         largely programs that are supposed to fail.\n"
    );
    let _ = writeln!(
        out,
        "The last two rows are the ones that must stay at zero: a panic or a \
         rejected SSA form on arbitrary input is a bug however well the \
         hand-written tests do, and so is a query this compiler makes that the \
         typechecker cannot answer.\n\nThe second row was counted as a typecheck \
         rejection until it was split out, which is how eight of these hid. Six \
         are now survived: a batched query that crashes tsgo is bisected and \
         retried, so one poisonous location costs its own type rather than the \
         file. The two that remain are an enum member whose value is `NaN`, \
         which tsgo cannot write as JSON at all — and they are reached through \
         queries whose answers are *sets* rather than positional lists, where \
         dropping the one that failed would quietly change a type rather than \
         leave a hole.\n"
    );

    let mut reasons: Vec<(&String, &usize)> = totals.reasons.iter().collect();
    reasons.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    // The caveat belongs *in the generator*, not in the README: this section is
    // rewritten on every corpus run, and a note added by hand between the
    // markers survives until the next one. It was, and it did not.
    out.push_str(
        "What is stopping the rest, in order — and **read this table as breadth \
         rather than as a work queue.** A refusal count and the lowered count are \
         different currencies and do not convert: a file refused for three reasons \
         does not lower when one of them is fixed. Default parameters cleared seven \
         files out of this table in one commit and moved *lowered completely* by \
         zero. The Node session watched the same thing at a larger scale — \
         twenty-five name collisions cleared, two functions gained, and thirty-five \
         *new* refusals, as functions that had stopped at the collision were walked \
         further and refused for their real reasons.\n\nSo a tall row means a \
         construct many files use, which is worth knowing. It does not mean that \
         fixing it moves the number above it.\n\n",
    );
    out.push_str("| refused | files |\n| --- | ---: |\n");
    for (reason, count) in reasons.iter().take(12) {
        let _ = writeln!(out, "| {reason} | {count} |");
    }
    out.push_str(
        "\nThis is a work queue ordered by evidence rather than intuition, which \
         is most of why it exists.\n",
    );

    let path = root.join("README.md");
    let text = std::fs::read_to_string(&path)?;
    let (Some(from), Some(to)) = (text.find(START), text.find(END)) else {
        bail!("README.md has no corpus markers");
    };
    std::fs::write(
        &path,
        format!("{}{START}\n{out}{}", &text[..from], &text[to..]),
    )?;
    Ok(())
}
