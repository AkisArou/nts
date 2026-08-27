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

/// What happened to one file.
enum Outcome {
    /// Lowered completely: every construct in it is supported.
    Lowered,
    /// Lowered in part. Carries what was refused.
    Refused(Vec<String>),
    /// The typechecker rejected it, which for a corpus of compiler tests is
    /// usually the point of the file rather than a failure.
    Rejected,
    /// Lowering produced HIR the verifier rejected. Always a bug.
    Invalid,
}

struct Totals {
    lowered: usize,
    refused: usize,
    rejected: usize,
    invalid: usize,
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

/// Every `.ts` and `.tsx` beneath a directory.
fn collect(dir: &Utf8Path, into: &mut Vec<Utf8PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {dir}"))? {
        let path = Utf8PathBuf::from_path_buf(entry?.path())
            .map_err(|path| anyhow::anyhow!("not utf-8: {}", path.display()))?;
        if path.is_dir() {
            collect(&path, into)?;
        } else if matches!(path.extension(), Some("ts" | "tsx")) {
            into.push(path);
        }
    }
    Ok(())
}

fn run(root: &Utf8Path, files: &[Utf8PathBuf], limit: usize) -> Result<Totals> {
    // One workspace, rewritten per file. A fresh directory per case would spend
    // more time in the filesystem than in the compiler.
    let work = root.join("target/suite");
    let src = work.join("src");
    std::fs::create_dir_all(&src)?;
    let tsconfig = work.join("tsconfig.json");
    std::fs::write(
        &tsconfig,
        r#"{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true }, "include": ["src"] }"#,
    )?;

    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut totals = Totals {
        lowered: 0,
        refused: 0,
        rejected: 0,
        invalid: 0,
        reasons: FxHashMap::default(),
    };

    let mut attempted = 0;
    for file in files {
        if attempted >= limit {
            break;
        }
        let text = std::fs::read_to_string(file).unwrap_or_default();
        if text.contains("@filename") {
            continue;
        }
        attempted += 1;

        let target = src.join(if file.extension() == Some("tsx") {
            "main.tsx"
        } else {
            "main.ts"
        });
        // Only one of the two may exist, or the compilation has two entry points.
        let _ = std::fs::remove_file(src.join("main.ts"));
        let _ = std::fs::remove_file(src.join("main.tsx"));
        std::fs::write(&target, &text)?;

        // A fresh frontend per file. Sharing one would be faster and would also
        // share whatever state a pathological input leaves behind, and the
        // point of a corpus is that some of these inputs are pathological.
        let mut source = TsgoApi::for_compilation(tsgo.clone());
        let outcome = match source.snapshot(&tsconfig) {
            Err(_) => Outcome::Rejected,
            Ok(snapshot) if snapshot.has_errors() => Outcome::Rejected,
            Ok(snapshot) => match hir::prepare(&snapshot) {
                Err(_) => Outcome::Invalid,
                Ok(prepared) if prepared.diagnostics.is_empty() => Outcome::Lowered,
                Ok(prepared) => Outcome::Refused(
                    prepared
                        .diagnostics
                        .iter()
                        .map(|diagnostic| shorten(&diagnostic.message))
                        .collect(),
                ),
            },
        };

        match outcome {
            Outcome::Lowered => totals.lowered += 1,
            Outcome::Rejected => totals.rejected += 1,
            Outcome::Invalid => {
                totals.invalid += 1;
                println!("INVALID HIR: {file}");
            }
            Outcome::Refused(reasons) => {
                totals.refused += 1;
                for reason in reasons {
                    *totals.reasons.entry(reason).or_default() += 1;
                }
            }
        }

        if attempted % 25 == 0 {
            println!("  {attempted} files...");
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
    let attempted = totals.lowered + totals.refused + totals.rejected + totals.invalid;
    println!("\n{attempted} single-file cases");
    println!("  lowered completely      {}", totals.lowered);
    println!("  refused a construct     {}", totals.refused);
    println!("  rejected by typecheck   {}", totals.rejected);
    println!("  invalid HIR             {}", totals.invalid);

    let mut reasons: Vec<(&String, &usize)> = totals.reasons.iter().collect();
    reasons.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    println!("\ntop refusals:");
    for (reason, count) in reasons.iter().take(15) {
        println!("  {count:4}  {reason}");
    }
}

fn write_readme(root: &Utf8Path, totals: &Totals) -> Result<()> {
    const START: &str = "<!-- corpus:start -->";
    const END: &str = "<!-- corpus:end -->";

    let attempted = totals.lowered + totals.refused + totals.rejected + totals.invalid;
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
        "The last row is the one that must stay at zero: a panic or a rejected \
         SSA form on arbitrary input is a bug however well the hand-written tests \
         do.\n"
    );

    let mut reasons: Vec<(&String, &usize)> = totals.reasons.iter().collect();
    reasons.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    out.push_str("What is stopping the rest, in order:\n\n");
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
