//! The public command table and the legacy readers must agree in both directions.
#![allow(clippy::expect_used, clippy::unwrap_used)]

#[path = "../src/arguments.rs"]
mod arguments;

use std::collections::{BTreeMap, BTreeSet};
use std::process::Command;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn every_command_rejects_a_bogus_flag_before_doing_work() {
    for command in arguments::COMMANDS {
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args([command.name, "--nts-unknown-option"])
            .output()
            .unwrap();
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success(), "{}: {error}", command.name);
        assert!(
            error.contains("unknown flag `--nts-unknown-option`"),
            "{}: {error}",
            command.name
        );
        assert!(
            error.contains(&format!("usage: nts {}", command.name)),
            "{error}"
        );
        for flag in command.flags() {
            assert!(error.contains(flag.name), "{error}");
        }
        let help = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args([command.name, "--help"])
            .output()
            .unwrap();
        assert!(help.status.success(), "{}: {:?}", command.name, help);
        assert!(String::from_utf8_lossy(&help.stdout).contains("USAGE"));
    }
}

#[test]
fn check_cannot_silently_select_c_for_a_backend_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["check", "--backend", "wasm"])
        .output()
        .unwrap();
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(
        error.contains("unknown flag `--backend` for `nts check`"),
        "{error}"
    );
    assert!(error.contains("--no-acquire"), "{error}");
}

#[test]
fn option_values_and_inline_forms_keep_their_existing_meaning() {
    assert!(
        arguments::validate(&args(&[
            "bind-c",
            "--clang",
            "--target=x86_64-linux-gnu",
            "--module",
            "x"
        ]))
        .is_ok()
    );
    assert_eq!(
        arguments::validate(&args(&["bind-c", "--clang", "--help"])),
        Ok(false)
    );
    assert_eq!(
        arguments::validate(&args(&[
            "emit",
            "--out=here",
            "--backends=c,llvm",
            "--host=browser"
        ])),
        Ok(false)
    );
    assert_eq!(
        arguments::validate(&args(&["emit-wasm", "--host=browser"])),
        Ok(false)
    );
    for values in [
        &["emit-c", "--out=here"][..],
        &["check", "--help", "--bogus"],
        &["hir", "--backend"],
        &["emit", "--out="],
    ] {
        assert!(arguments::validate(&args(values)).is_err(), "{values:?}");
    }
    assert_eq!(arguments::validate(&args(&["check", "--rc"])), Ok(false));
    assert_eq!(
        arguments::validate(&args(&["frontend", "--checkers", "4", "project"])),
        Ok(false)
    );
    assert_eq!(
        arguments::validate(&args(&["deps", "--checkers", "1", "--json"])),
        Ok(false)
    );
    for deleted in ["--decompose", "--calls", "--constants"] {
        assert!(arguments::validate(&args(&["frontend", deleted])).is_err());
    }
    assert!(arguments::takes_value("--backend"));
    assert!(arguments::takes_value("--checkers"));
    assert!(!arguments::takes_value("--rc"));
}

#[test]
fn a_backend_value_before_the_project_is_not_a_project() {
    let missing = "__nts_backend_value_is_not_the_project__";
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["hir", "--backend", "llvm", "--no-acquire", missing])
        .output()
        .unwrap();
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(error.contains(missing), "{error}");
    assert!(!error.contains("`llvm` does not exist"), "{error}");
}

#[test]
fn check_rc_reaches_the_differential_librarys_provider_selection() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for counting in [false, true] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nts"));
        command
            .current_dir(&root)
            .args([
                "check",
                "tests/programs/a-cast-reads-a-field-another-layout-holds",
                "--no-acquire",
            ])
            .env("NTS_BACKEND", "wasm")
            .env("NTS_RC", "0");
        if counting {
            command.arg("--rc");
        }
        let output = command.output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if counting {
            assert!(!output.status.success(), "{stdout}\n{stderr}");
            assert!(stderr.contains("wasm declines --rc"), "{stdout}\n{stderr}");
        } else {
            assert!(output.status.success(), "{stdout}\n{stderr}");
            assert!(
                stdout.contains("checked 87 cases across 3 function(s)"),
                "{stdout}\n{stderr}"
            );
        }
    }
}

#[derive(Clone, Debug)]
enum Token {
    Word(String),
    Text(String),
    Mark(u8),
}

/// Only lex enough Rust to find function bodies and literal option reads.
/// Comments, raw strings and character literals cannot supply braces or flags.
fn tokens(text: &str) -> Vec<Token> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at..].starts_with(b"//") {
            while at < bytes.len() && bytes[at] != b'\n' {
                at += 1;
            }
        } else if bytes[at..].starts_with(b"/*") {
            let mut depth = 1;
            at += 2;
            while at < bytes.len() && depth > 0 {
                if bytes[at..].starts_with(b"/*") {
                    depth += 1;
                    at += 2;
                } else if bytes[at..].starts_with(b"*/") {
                    depth -= 1;
                    at += 2;
                } else {
                    at += 1;
                }
            }
        } else if bytes[at] == b'r' && bytes.get(at + 1).is_some_and(|b| *b == b'#' || *b == b'"') {
            let begin = at;
            at += 1;
            while bytes.get(at) == Some(&b'#') {
                at += 1;
            }
            if bytes.get(at) != Some(&b'"') {
                out.push(Token::Word("r".into()));
                continue;
            }
            let hashes = at - begin - 1;
            at += 1;
            while at < bytes.len() {
                if bytes[at] == b'"'
                    && bytes
                        .get(at + 1..at + 1 + hashes)
                        .is_some_and(|tail| tail.iter().all(|b| *b == b'#'))
                {
                    at += hashes + 1;
                    break;
                }
                at += 1;
            }
        } else if bytes[at] == b'"' {
            at += 1;
            let start = at;
            while at < bytes.len() && bytes[at] != b'"' {
                at += if bytes[at] == b'\\' { 2 } else { 1 };
            }
            out.push(Token::Text(text[start..at.min(bytes.len())].to_owned()));
            at += 1;
        } else if bytes[at] == b'\''
            && (bytes.get(at + 2) == Some(&b'\'') || bytes.get(at + 1) == Some(&b'\\'))
        {
            at += 1;
            while at < bytes.len() {
                if bytes[at] == b'\'' {
                    at += 1;
                    break;
                }
                at += if bytes[at] == b'\\' { 2 } else { 1 };
            }
        } else if bytes[at].is_ascii_alphabetic() || bytes[at] == b'_' {
            let start = at;
            at += 1;
            while at < bytes.len() && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_') {
                at += 1;
            }
            out.push(Token::Word(text[start..at].into()));
        } else {
            if !bytes[at].is_ascii_whitespace() {
                out.push(Token::Mark(bytes[at]));
            }
            at += 1;
        }
    }
    out
}

fn word(token: &Token, expected: &str) -> bool {
    matches!(token, Token::Word(value) if value == expected)
}
fn mark(token: &Token, expected: u8) -> bool {
    matches!(token, Token::Mark(value) if *value == expected)
}
fn block_end(tokens: &[Token], start: usize) -> usize {
    let mut depth = 0;
    for (index, token) in tokens.iter().enumerate().skip(start) {
        if mark(token, b'{') {
            depth += 1;
        }
        if mark(token, b'}') {
            depth -= 1;
            if depth == 0 {
                return index + 1;
            }
        }
    }
    panic!("unclosed Rust block");
}
fn functions(tokens: &[Token]) -> BTreeMap<String, Vec<(usize, usize)>> {
    let mut found = BTreeMap::<String, Vec<_>>::new();
    for at in 0..tokens.len().saturating_sub(2) {
        if !word(&tokens[at], "fn") {
            continue;
        }
        let Token::Word(name) = &tokens[at + 1] else {
            continue;
        };
        let Some(open) = (at + 2..tokens.len())
            .find(|index| mark(&tokens[*index], b'{') || mark(&tokens[*index], b';'))
        else {
            continue;
        };
        if mark(&tokens[open], b'{') {
            found
                .entry(name.clone())
                .or_default()
                .push((open, block_end(tokens, open)));
        }
    }
    found
}

fn flags(tokens: &[Token]) -> BTreeSet<String> {
    tokens
        .iter()
        .filter_map(|token| {
            let Token::Text(text) = token else {
                return None;
            };
            let text = text.trim_end_matches('=');
            ((text.starts_with("--") && text.len() > 2 || text == "-h")
                && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
            .then(|| text.to_owned())
        })
        .collect()
}

fn arm<'a>(tokens: &'a [Token], command: &str) -> &'a [Token] {
    for at in 0..tokens.len().saturating_sub(6) {
        if word(&tokens[at], "Some")
            && mark(&tokens[at + 1], b'(')
            && matches!(&tokens[at + 2], Token::Text(name) if name == command)
            && mark(&tokens[at + 3], b')')
            && mark(&tokens[at + 4], b'=')
            && mark(&tokens[at + 5], b'>')
            && mark(&tokens[at + 6], b'{')
        {
            return &tokens[at + 6..block_end(tokens, at + 6)];
        }
    }
    panic!("no block arm for {command}");
}

fn reader_groups() -> BTreeMap<&'static str, BTreeSet<String>> {
    let main = tokens(include_str!("../src/main.rs"));
    let bodies = functions(&main);
    let mut consumed = BTreeMap::<&str, BTreeSet<String>>::new();
    let mut group = |name: &'static str, readers: &[&str]| {
        let mut values = BTreeSet::new();
        for reader in readers {
            for &(start, end) in bodies
                .get(*reader)
                .unwrap_or_else(|| panic!("missing reader {reader}"))
            {
                values.extend(flags(&main[start..end]));
            }
        }
        consumed.insert(name, values);
    };
    group("project", &["project_to"]);
    group("roots", &["entry_names", "requested_product"]);
    group("provider", &["selected_provider", "rc_requested"]);
    group("shape", &["from_flags"]);
    group("listing", &["hir_preparation"]);
    group("build", &["build", "output_root"]);
    group("bind-c", &["bind_c"]);
    group("bind-objc", &["bind_objc", "bind_objc_project"]);
    group("bind-gir", &["bind_gir"]);
    group("bind-winmd", &["bind_winmd"]);
    group("bind", &["bind_java"]);
    group("hir", &["dump_hir"]);
    group("receivers", &["dump_receivers"]);
    group("deps", &["deps"]);
    // Project capture and standalone acquisition share one count reader.
    let checkers = include_str!("../src/checkers.rs")
        .split("#[cfg(test)]")
        .next()
        .unwrap();
    let checkers = flags(&tokens(checkers));
    consumed
        .get_mut("project")
        .unwrap()
        .extend(checkers.clone());
    consumed.get_mut("deps").unwrap().extend(checkers);
    for name in [
        "frontend",
        "emit-c",
        "emit-llvm",
        "emit-jvm",
        "facts",
        "erasure",
    ] {
        consumed.insert(name, flags(arm(&main, name)));
    }
    for (name, source) in [
        ("emit", include_str!("../src/multi_emit.rs")),
        ("emit-wasm", include_str!("../src/wasm.rs")),
    ] {
        let before_tests = source.split("#[cfg(test)]").next().unwrap();
        consumed.insert(name, flags(&tokens(before_tests)));
    }
    // Multi-backend emission delegates host parsing to the Wasm reader.
    let wasm = tokens(include_str!("../src/wasm.rs"));
    let (start, end) = functions(&wasm)["host"][0];
    consumed
        .get_mut("emit")
        .unwrap()
        .extend(flags(&wasm[start..end]));
    let differential = tokens(include_str!("../../differential/src/lib.rs"));
    let (start, end) = functions(&differential)["counting"][0];
    consumed.insert("counting", flags(&differential[start..end]));
    consumed
}

#[test]
fn declarations_match_the_options_the_legacy_command_readers_consume() {
    let consumed = reader_groups();
    for command in arguments::COMMANDS {
        let groups: &[&str] = match command.name {
            "frontend" => &["project", "frontend"],
            "build" => &["project", "build", "roots", "provider"],
            "check" => &["project", "counting"],
            "types" | "refusals" | "layouts" | "modules" => &["project"],
            "bind-c" => &["bind-c"],
            "bind-objc" => &["bind-objc"],
            "bind-gir" => &["bind-gir"],
            "bind-winmd" => &["bind-winmd"],
            "bind" => &["bind"],
            "emit" => &["project", "roots", "provider", "shape", "emit"],
            "emit-c" => &["project", "roots", "provider", "shape", "emit-c"],
            "emit-llvm" => &["project", "roots", "provider", "shape", "emit-llvm"],
            "emit-jvm" => &["project", "roots", "provider", "shape", "emit-jvm"],
            "emit-wasm" => &["project", "roots", "provider", "shape", "emit-wasm"],
            "hir" => &["project", "roots", "provider", "shape", "listing", "hir"],
            "stats" | "regions" => &["project", "roots", "provider", "shape", "listing"],
            "expect-ir" => &["project", "roots", "provider", "shape"],
            "facts" => &["project", "facts"],
            "erasure" => &["project", "erasure"],
            "receivers" => &["project", "receivers"],
            "deps" => &["deps"],
            "help" | "version" => &[],
            other => panic!("audit the new command's readers: {other}"),
        };
        let mut reads: BTreeSet<_> = groups
            .iter()
            .flat_map(|group| consumed[*group].iter().cloned())
            .collect();
        // The shipping-only operand is short-circuited for every other command.
        if command.name != "build" {
            reads.remove("--nogc");
        }
        reads.extend(["--help".to_owned(), "-h".to_owned()]);
        let declared: BTreeSet<_> = command.flags().map(|flag| flag.name.to_owned()).collect();
        assert_eq!(
            declared, reads,
            "{}: declared options and actual reader literals differ",
            command.name
        );
    }
}

#[test]
fn every_dispatched_command_has_a_validation_declaration() {
    let source = tokens(include_str!("../src/main.rs"));
    let bodies = functions(&source);
    let (begin, end) = bodies.get("run_command").unwrap_or(&bodies["main"])[0];
    let mut dispatched = BTreeSet::new();
    for part in source[begin..end].windows(3) {
        if word(&part[0], "Some")
            && mark(&part[1], b'(')
            && let Token::Text(name) = &part[2]
            && !name.starts_with('-')
        {
            dispatched.insert(name.clone());
        }
    }
    let declared: BTreeSet<_> = arguments::COMMANDS
        .iter()
        .map(|command| command.name.to_owned())
        .collect();
    assert_eq!(declared, dispatched);
}

#[test]
fn every_remaining_process_argv_reader_is_in_the_migration_inventory() {
    let source = tokens(include_str!("../src/main.rs"));
    let bodies = functions(&source);
    let mut readers = BTreeSet::new();
    for (name, spans) in bodies {
        for (begin, end) in spans {
            if source[begin..end].windows(7).any(|part| {
                word(&part[0], "std")
                    && mark(&part[1], b':')
                    && mark(&part[2], b':')
                    && word(&part[3], "env")
                    && mark(&part[4], b':')
                    && mark(&part[5], b':')
                    && word(&part[6], "args")
            }) {
                readers.insert(name.clone());
            }
        }
    }
    let expected: BTreeSet<_> = [
        "arguments",
        "entry_names",
        "hir_preparation",
        "dump_hir",
        "from_flags",
        "requested_product",
        "rc_requested",
        "selected_provider",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(
        readers, expected,
        "pass parsed arguments to new helpers instead of adding another process argv reader"
    );
}
