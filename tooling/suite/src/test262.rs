//! test262's numeric slice, used as a source of expressions rather than of
//! expected values.
//!
//! # Why not run it as a suite
//!
//! Because it cannot be run as one. Every file expects a JavaScript runtime with
//! `assert.js`, `sta.js` and `propertyHelper.js` loaded, an `Object.prototype`
//! to hang things off, and a great deal else this compiler will never have. A
//! harness that reproduced enough of that to execute the files would be a small
//! JavaScript engine, which is the thing the project exists not to ship.
//!
//! What test262 has that is worth taking is the *arguments*. `Math.round(-0.5)`,
//! `Math.max(-0, 0)`, `(-2147483648 | 0) >>> 0` — thousands of expressions
//! written by people trying to break implementations, and every one of them a
//! case nobody here would have thought to write.
//!
//! So the expressions are extracted and the *expected values are discarded*. The
//! oracle is node, via `nts check`, which is a better one anyway: it is the
//! engine, rather than a file asserting what the engine should do.
//!
//! # What this actually tests
//!
//! Mostly the constant folder. An expression made entirely of literals is folded
//! at compile time by `hir::fold` using `hir::facts`, so what runs on the native
//! side is a constant this compiler computed — and comparing it against node is
//! exactly a test of the abstract semantics. That is where `Math.round` near
//! 2^53 was wrong, in the folder and the runtime both, with a property test that
//! could not see it because it compared against the same expression.
//!
//! # The filter
//!
//! An expression is taken only if every token in it is something this compiler
//! could be expected to handle: numeric literals, `Math` and `Number` members,
//! operators, and the three named constants. Anything else — a variable, a
//! string, a call to something else — is skipped rather than guessed at. The
//! skipped count is reported, because a filter that quietly drops most of its
//! input looks the same as one that finds nothing wrong.

use std::fmt::Write as _;

use anyhow::Result;
use camino::Utf8Path;

/// How many expressions go into one generated program.
///
/// Small enough that a refusal loses a chunk rather than the run, large enough
/// that the frontend is not started thousands of times.
const CHUNK: usize = 400;

/// What one run of the numeric slice found.
pub(crate) struct Findings {
    pub(crate) files: usize,
    pub(crate) extracted: usize,
    pub(crate) skipped: usize,
    pub(crate) checked: usize,
    pub(crate) refused: usize,
    pub(crate) disagreements: Vec<(String, String)>,
}

/// Extract, compile, and compare against node.
pub(crate) fn run(root: &Utf8Path, corpus: &Utf8Path) -> Result<Findings> {
    let mut files = Vec::new();
    super::collect_with(corpus, &mut files, "js")?;
    files.sort();

    let mut expressions: Vec<String> = Vec::new();
    let mut skipped = 0;
    for file in &files {
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        for expression in extract(&text) {
            if usable(&expression) {
                expressions.push(expression);
            } else {
                skipped += 1;
            }
        }
    }
    expressions.sort();
    expressions.dedup();

    let work = root.join("target/suite262");
    let src = work.join("src");
    std::fs::create_dir_all(&src)?;
    std::fs::write(
        work.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true }, "include": ["src"] }"#,
    )?;

    let mut findings = Findings {
        files: files.len(),
        extracted: expressions.len(),
        skipped,
        checked: 0,
        refused: 0,
        disagreements: Vec::new(),
    };

    for (chunk, group) in expressions.chunks(CHUNK).enumerate() {
        let mut program = String::from(
            "// Generated from test262 by `nts-suite test262`. The expected values\n\
             // are deliberately not carried over: node is the oracle.\n",
        );
        for (at, expression) in group.iter().enumerate() {
            // No return annotation: TypeScript infers `number` or `boolean`,
            // and the checker reads whichever from the lowered signature. Forcing
            // `number` here would mean discarding every comparison, which is
            // most of what the operator tests are.
            let _ = writeln!(
                program,
                "export function case_{chunk}_{at}() {{ return {expression}; }}"
            );
        }
        std::fs::write(src.join("main.ts"), &program)?;

        match nts_differential::check(&work.join("tsconfig.json")) {
            Ok(report) => {
                findings.checked += report.checked;
                findings.refused += group.len().saturating_sub(report.functions);
                findings.disagreements.extend(report.disagreements);
            }
            Err(error) => {
                // A chunk that will not compile at all is reported as refused
                // rather than aborting: one bad expression should not take out
                // the other three hundred and ninety-nine.
                eprintln!("  chunk {chunk} did not run: {error:#}");
                findings.refused += group.len();
            }
        }
        println!(
            "  {} of {} expressions...",
            (chunk * CHUNK) + group.len(),
            expressions.len()
        );
    }
    Ok(findings)
}

/// The first argument of every `assert.sameValue(...)` in a file, with simple
/// bindings substituted.
///
/// Most of these files are written `var x = -0.5; assert.sameValue(Math.round(x),
/// ...)`, so an extractor that only reads the call finds almost nothing. Reading
/// the file in order and remembering `var name = <expression>;` recovers the
/// argument, which is the part worth having.
fn extract(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut bindings: Vec<(String, String)> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line
            .strip_prefix("var ")
            .or_else(|| line.strip_prefix("let "))
        {
            if let Some((name, value)) = rest.split_once('=') {
                let name = name.trim();
                let value = value.trim().trim_end_matches(';').trim();
                if name
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
                {
                    let resolved = substitute(value, &bindings);
                    bindings.retain(|(bound, _)| bound != name);
                    bindings.push((name.to_owned(), resolved));
                }
            }
            continue;
        }
        let Some(at) = line.find("assert.sameValue(") else {
            continue;
        };
        let after = &line[at + "assert.sameValue(".len()..];
        if let Some(argument) = first_argument(after) {
            found.push(substitute(&argument, &bindings));
        }
    }
    found
}

/// Replace bound names with what they were bound to.
///
/// Whole words only, so `x` in `Math.max` is not a name. Bindings are applied
/// longest-first, so `x1` is not rewritten by a rule for `x`.
fn substitute(expression: &str, bindings: &[(String, String)]) -> String {
    let mut ordered: Vec<&(String, String)> = bindings.iter().collect();
    ordered.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));

    let mut out = String::new();
    let mut rest = expression;
    'outer: while !rest.is_empty() {
        for (name, value) in &ordered {
            if rest.starts_with(name.as_str()) {
                let after = rest[name.len()..].chars().next();
                let before = out.chars().last();
                let boundary = |ch: Option<char>| {
                    ch.is_none_or(|ch| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '.')
                };
                if boundary(before) && boundary(after) {
                    out.push('(');
                    out.push_str(value);
                    out.push(')');
                    rest = &rest[name.len()..];
                    continue 'outer;
                }
            }
        }
        let mut chars = rest.chars();
        if let Some(ch) = chars.next() {
            out.push(ch);
        }
        rest = chars.as_str();
    }
    out
}

/// Text up to the top-level comma or closing parenthesis.
///
/// A hand-written scan rather than a parser, which is enough because it is
/// allowed to give up: anything it reads wrongly fails the filter below and is
/// skipped.
fn first_argument(text: &str) -> Option<String> {
    let mut depth = 0_i32;
    for (at, ch) in text.char_indices() {
        // A top-level `)` or `,` ends the argument; a nested one is part of it.
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' | ',' if depth == 0 => return Some(text[..at].trim().to_owned()),
            ')' | ']' => depth -= 1,
            // A string is not an expression this can use, and giving up here
            // beats carrying quotes into generated TypeScript.
            '\n' | '"' | '\'' | '`' => return None,
            _ => {}
        }
    }
    None
}

/// Whether an expression is made only of things this compiler could handle.
///
/// A whitelist, not a blacklist. Anything unrecognised is skipped, because a
/// generated program that does not compile teaches nothing and a generated
/// program that compiles to the wrong thing teaches something false.
fn usable(expression: &str) -> bool {
    /// Every `<math.h>`-free `Math` member this compiler lowers, and the named
    /// numeric constants. `Math.log` is a perfectly good test of an engine and
    /// says nothing about a compiler that refuses it.
    const ALLOWED: &[&str] = &[
        "Math.abs",
        "Math.ceil",
        "Math.floor",
        "Math.max",
        "Math.min",
        "Math.round",
        "Math.trunc",
        "Number.MAX_SAFE_INTEGER",
        "Number.MIN_SAFE_INTEGER",
        "Number.MAX_VALUE",
        "Number.MIN_VALUE",
        "Number.EPSILON",
        "Infinity",
        "NaN",
    ];

    if expression.is_empty() || expression.len() > 200 {
        return false;
    }
    // `++` and `--` need a variable, and substitution has replaced every
    // variable with the value it held.
    //
    // `=` is rejected in every spelling: it is an assignment (`**=`), an arrow
    // (`=>`), or a comparison, and the first two do not typecheck as the body of
    // a generated function while the third is less interesting than the
    // arithmetic. `!` goes with it because `!(3 ** 2)` is an error under
    // `strict` rather than a test.
    //
    // One expression that does not typecheck fails the whole chunk it is in, so
    // this filter has to be certain rather than merely likely.
    if expression.contains("++")
        || expression.contains("--")
        || expression.contains('=')
        || expression.contains('!')
    {
        return false;
    }

    let bytes = expression.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        let ch = bytes[at] as char;
        if ch.is_ascii_alphabetic() || ch == '_' || ch == '$' {
            // An identifier, which must be one of the allowed ones in full.
            let Some(name) = ALLOWED
                .iter()
                .find(|allowed| expression[at..].starts_with(**allowed))
            else {
                return false;
            };
            at += name.len();
        } else if ch.is_ascii_digit()
            || (ch == '.' && bytes.get(at + 1).is_some_and(u8::is_ascii_digit))
        {
            // A number, in any spelling: decimal, hex, exponent.
            at += 1;
            while at < bytes.len() {
                let ch = bytes[at] as char;
                let exponent = matches!(ch, '+' | '-')
                    && matches!(bytes[at - 1] as char, 'e' | 'E')
                    && !expression[..at].ends_with("0x");
                // `1n` is a BigInt, which is a different type with different
                // arithmetic and which TypeScript will not let near a `number`.
                if ch == 'n' {
                    return false;
                }
                if ch.is_ascii_alphanumeric() || ch == '.' || exponent {
                    at += 1;
                } else {
                    break;
                }
            }
        } else if " \t+-*/%<>&|^~()?:,".contains(ch) {
            at += 1;
        } else {
            return false;
        }
    }
    true
}
