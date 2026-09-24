//! The generated signature table, checked against clang.
//!
//! `src/signatures.rs` is generated from `runtime/c/nts_runtime.h` and checked
//! in, which is only safe while something notices when it drifts. This is that
//! something: it asks clang for the header's declarations again and compares.
//! Run it with `NTS_REGENERATE=1` and it writes the table instead of checking
//! it, so the generated file has a generator that lives beside its check and
//! cannot answer a different question from it. It writes one entry per line and
//! rustfmt then breaks them up, which is churn rather than a problem: the
//! markers it looks for are the array's opening and closing lines, and those
//! survive formatting.
//!
//! It exists because the alternative failed. Reading a helper's signature off
//! the *call site* is sound only where the lowering's types and the runtime's
//! already agree, and `nts_tag_name` takes a `uint32_t` where the lowering
//! hands it a double -- C converts implicitly at the call and the C backend
//! never had to notice. The declared double went into an SSE register, the
//! callee read an integer one, and `typeof v` answered "undefined" for a
//! number.
//!
//! Attributes are compared too, and not as a formality: `NTS_READS_ONLY` on a
//! loop-invariant `indexOf` is worth 5x, and an attribute that quietly stopped
//! being emitted would cost that with every test still green.
//!
//! Skips without clang, like every other test here that needs a toolchain --
//! but *fails* when clang is present and the probe does not compile, because
//! that is a broken header rather than a missing tool, and a skip would hide
//! it.

use std::fmt::Write as _;

use nts_codegen_llvm::signatures::{SIGNATURES, Signature};
use nts_codegen_llvm::signatures_arm64::SIGNATURES_ARM64;
use nts_codegen_llvm::signatures_win64::SIGNATURES_WIN64;

/// A generated table: where it lives, and what clang is asked with.
struct Table {
    file: &'static str,
    open: &'static str,
    rows: &'static [Signature],
}

const SYSV: Table = Table {
    file: "compiler/codegen/llvm/src/signatures.rs",
    open: "pub const SIGNATURES: &[Signature] = &[\n",
    rows: SIGNATURES,
};

const WIN64: Table = Table {
    file: "compiler/codegen/llvm/src/signatures_win64.rs",
    open: "pub const SIGNATURES_WIN64: &[Signature] = &[\n",
    rows: SIGNATURES_WIN64,
};

const ARM64: Table = Table {
    file: "compiler/codegen/llvm/src/signatures_arm64.rs",
    open: "pub const SIGNATURES_ARM64: &[Signature] = &[\n",
    rows: SIGNATURES_ARM64,
};

/// clang's flags for arm64 macOS: the target and the SDK the Apple lane
/// builds with (`NTS_APPLE_SDK`, or where `tooling/apple/sync-sdk.sh` puts
/// it). `None` without it.
fn arm64_flags() -> Option<Vec<String>> {
    let sdk = std::env::var_os("NTS_APPLE_SDK").map(std::path::PathBuf::from).or_else(|| {
        std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".cache/nts/apple/MacOSX.sdk"))
    })?;
    sdk.join("usr/include").is_dir().then(|| {
        vec!["--target=arm64-apple-macos13".to_owned(), "-isysroot".to_owned(), sdk.to_string_lossy().into_owned()]
    })
}

/// clang's flags for `x86_64` Windows: the target and zig's mingw headers,
/// as `nts build` compiles the runtime there. `None` without zig.
fn win64_flags() -> Option<Vec<String>> {
    let env = std::process::Command::new("zig").arg("env").output().ok()?;
    let text = String::from_utf8_lossy(&env.stdout);
    let lib = text.lines().find_map(|line| line.trim().strip_prefix(".lib_dir = \"")?.strip_suffix("\","))?;
    let headers = std::path::Path::new(lib).join("libc/include");
    let mut flags = vec!["--target=x86_64-w64-windows-gnu".to_owned(), "-nostdlibinc".to_owned()];
    for directory in ["x86_64-windows-gnu", "generic-mingw", "x86_64-windows-any", "any-windows-any"] {
        flags.push("-isystem".to_owned());
        flags.push(headers.join(directory).to_string_lossy().into_owned());
    }
    flags.extend(["-D__MSVCRT_VERSION__=0xE00".to_owned(), "-D_WIN32_WINNT=0x0a00".to_owned()]);
    Some(flags)
}

struct Declared {
    name: String,
    returns: String,
    params: Vec<String>,
    attributes: Vec<String>,
}

/// Split an attribute list on whitespace, except inside parentheses:
/// `memory(argmem: readwrite)` is one attribute with a space in it.
fn attributes_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '(' => {
                depth += 1;
                current.push(c);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(c);
            }
            c if c.is_whitespace() && depth == 0 => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    // A quoted attribute is a target or codegen setting -- "target-cpu",
    // "stack-protector-buffer-size". Those belong to whoever links this, not to
    // a declaration of what the function does.
    out.retain(|a| !a.starts_with('"'));
    out
}

fn tidy(text: &str) -> String {
    // The one named type a Win64 declaration mentions, spelled as the literal
    // type of the same size and alignment so a module need not define it.
    text.replace("sret(%struct.NtsValue)", "sret({ i32, i64 })")
        // A linkage hint clang writes on Windows, not part of the type: call
        // sites splice `returns` in as the type they call at.
        .replace("dso_local", "")
        .replace("noundef", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A probe directory per call (see where it is read).
static PROBES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// The `nts_` functions the headers in `dir` declare for the target `flags`
/// name -- declarations, not `static inline` definitions, which have no symbol.
fn declared_names(dir: &std::path::Path, flags: &[String]) -> Option<Vec<String>> {
    // **The target's declarations, preprocessed**, not the headers' text: a
    // Windows-only helper sits under `#if defined(_WIN32)`, so it is in the
    // Win64 table and not System V's -- each table is what its target's
    // compiler sees. Read as text, the System V probe named the Windows
    // helpers and failed to compile, on the one box that cannot build them.
    // Comments go too, so one mentioning `nts_foo(` is no longer a candidate.
    std::fs::write(dir.join("names.c"), "#include \"nts_runtime.h\"\n#include \"nts_unicode.h\"\n").ok()?;
    let preprocessed = std::process::Command::new("clang")
        .args(flags)
        .args(["-E", "-P", "-w", "-I"])
        .arg(dir)
        .arg(dir.join("names.c"))
        .output()
        .ok()?;
    assert!(
        preprocessed.status.success(),
        "the headers did not preprocess:\n{}",
        String::from_utf8_lossy(&preprocessed.stderr)
    );
    let text = String::from_utf8_lossy(&preprocessed.stdout).into_owned();
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        // A declaration, not a `static inline` definition: the second has no
        // symbol for anything to link against, which is the whole distinction
        // this table exists to respect.
        let trimmed = line.trim_start();
        if trimmed.starts_with("static") || !line.contains("nts_") || !line.contains('(') {
            continue;
        }
        // The first `nts_` identifier directly followed by `(`: the function's
        // name, which is not the first parenthesis on the line when the
        // function returns a function pointer --
        // `void (*nts_closure_notify(void))(void *);` read by its first `(`
        // named a function `void`, and the helper was carried by hand.
        let Some(open) = line.match_indices("nts_").find_map(|(at, _)| {
            let rest = &line[at..];
            let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_'))?;
            rest[end..].starts_with('(').then_some(at + end)
        }) else {
            continue;
        };
        let before = &line[..open];
        // Where the name starts. `rfind` answering nothing means the whole of
        // `before` *is* the name -- a declaration whose return type wrapped to
        // the previous line, which is what clang-format does once a line gets
        // long enough. That used to `continue`, so adding an attribute to
        // `nts_array_new_uninitialized` reflowed its declaration, dropped it
        // from the table, and left the backend emitting a call to a helper it
        // then neither declared nor converted the argument for.
        let start = before
            .rfind(|c: char| !(c.is_alphanumeric() || c == '_'))
            .map_or(0, |at| at + 1);
        let name = &before[start..];
        if !name.starts_with("nts_") || names.iter().any(|known| known == name) {
            continue;
        }
        // Only a declaration ends in `);` on the same line or continues; a
        // definition opens a brace.
        if line.contains('{') {
            continue;
        }
        names.push(name.to_owned());
    }
    Some(names)
}

/// Reference every runtime function so clang has to declare it, then read the
/// declarations back.
fn from_clang(root: &std::path::Path, flags: &[String]) -> Option<Vec<Declared>> {
    // **Both** headers. `nts_unicode.h` declares `nts_str_to_lower_case` and
    // `nts_str_to_upper_case`, and reading only `nts_runtime.h` made this
    // generator delete them on every run -- they had been added to the table by
    // hand, which is what the sortedness test above already records as having
    // cost "the LLVM column of a whole benchmark row, with a refusal message
    // pointing at the wrong file".
    //
    // It cost it a second time on 2026-09-05, to `examples/strings`, because
    // regenerating for an unrelated addition silently dropped both. A generator
    // whose source of truth is narrower than the table it generates is a trap
    // that springs on whoever next has a reason to run it.
    let header = root.join("runtime/c/nts_runtime.h");
    let unicode = root.join("runtime/c/nts_unicode.h");
    // One directory per call, not per process: the SysV and Win64 checks run
    // this at once, and one copying the header over the other's mid-compile
    // failed as "nts_runtime.h is broken" one run in a few.
    let probe = PROBES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("nts-sigs-{}-{probe}", std::process::id()));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::copy(&header, dir.join("nts_runtime.h")).ok()?;
    std::fs::copy(&unicode, dir.join("nts_unicode.h")).ok()?;
    let names = declared_names(&dir, flags)?;
    if names.is_empty() {
        return None;
    }

    let mut source = String::from(
        "#include \"nts_runtime.h\"\n#include \"nts_unicode.h\"\nvoid *nts_all[] = {\n",
    );
    for name in &names {
        let _ = writeln!(source, "  (void *){name},");
    }
    source.push_str("};\n");
    std::fs::write(dir.join("all.c"), source).ok()?;

    let output = std::process::Command::new("clang")
        .args(flags)
        .args(["-S", "-emit-llvm", "-O0", "-w", "-I"])
        .arg(&dir)
        .arg(dir.join("all.c"))
        .arg("-o")
        .arg("-")
        .output()
        .ok()?;
    // clang ran and refused. That is the header's problem, not a missing
    // toolchain, and skipping would hide it.
    assert!(
        output.status.success(),
        "the probe did not compile -- nts_runtime.h is broken:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let ir = String::from_utf8_lossy(&output.stdout);

    // Attribute groups are printed after the declarations that reference them.
    let mut groups: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for line in ir.lines() {
        let Some(rest) = line.strip_prefix("attributes #") else {
            continue;
        };
        let Some((number, body)) = rest.split_once('=') else {
            continue;
        };
        let body = body.trim().trim_start_matches('{').trim_end_matches('}');
        groups.insert(format!("#{}", number.trim()), attributes_in(body));
    }

    let mut found: Vec<Declared> = Vec::new();
    for line in ir.lines() {
        let Some(rest) = line.strip_prefix("declare ") else {
            continue;
        };
        let Some(at) = rest.find('@') else { continue };
        let returns = tidy(&rest[..at]);
        let after = &rest[at + 1..];
        let Some(open) = after.find('(') else { continue };
        let name = after[..open].to_owned();
        let Some(close) = after.rfind(')') else { continue };
        let params: Vec<String> = after[open + 1..close]
            .split(',')
            .map(tidy)
            .filter(|part| !part.is_empty())
            .collect();
        // Everything after the parameter list is either a group reference or a
        // per-declaration flag like `local_unnamed_addr`, which says nothing
        // about what the function does.
        let attributes = after[close + 1..]
            .split_whitespace()
            .find(|word| word.starts_with('#'))
            .and_then(|reference| groups.get(reference).cloned())
            .unwrap_or_default();
        found.push(Declared { name, returns, params, attributes });
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    Some(found)
}

/// Rewrite the table between its markers, leaving the module's own explanation
/// of why it is generated where it is.
fn regenerate(root: &std::path::Path, fresh: &[Declared], table: &Table) {
    const CLOSE: &str = "];\n";

    let path = root.join(table.file);
    let text = std::fs::read_to_string(&path).expect("the table's file");
    let start = text.find(table.open).expect("the table's opening") + table.open.len();
    let end = start + text[start..].find(CLOSE).expect("the table's close");

    // Names the table already carries that clang did not report -- the LLVM
    // intrinsics the backend reaches for, which are not in the C header and
    // are the same on every target, so System V's list is every table's.
    let mut rows: Vec<String> = SIGNATURES
        .iter()
        .filter(|known| !known.name.starts_with("nts_") && !fresh.iter().any(|f| f.name == known.name))
        .map(|known| row(known.name, known.returns, known.params, known.attributes))
        .collect();
    for declared in fresh {
        let params: Vec<&str> = declared.params.iter().map(String::as_str).collect();
        let attributes: Vec<&str> = declared.attributes.iter().map(String::as_str).collect();
        rows.push(row(&declared.name, &declared.returns, &params, &attributes));
    }
    rows.sort_by_key(|line| {
        line.split("name: \"").nth(1).unwrap_or("").split('"').next().unwrap_or("").to_owned()
    });

    let mut out = String::new();
    out.push_str(&text[..start]);
    for line in &rows {
        out.push_str(line);
    }
    out.push_str(&text[end..]);
    std::fs::write(&path, out).expect("write the table");
    eprintln!("regenerated {} entries", rows.len());
}

fn row(name: &str, returns: &str, params: &[&str], attributes: &[&str]) -> String {
    let list = |items: &[&str]| {
        if items.is_empty() {
            "&[]".to_owned()
        } else {
            format!("&[{}]", items.iter().map(|i| format!("\"{i}\"")).collect::<Vec<_>>().join(", "))
        }
    };
    format!(
        "    Signature {{ name: \"{name}\", returns: \"{returns}\", params: {}, attributes: {} }},\n",
        list(params),
        list(attributes)
    )
}

#[test]
fn the_table_still_matches_the_header() {
    check(&SYSV, &[]);
}

/// Every Win64 helper fits the scratch slots a call site passes sixteen-byte
/// values through (`indirect.rs`): one that needed a third would have it
/// written over the second.
#[test]
fn no_win64_helper_takes_more_indirect_arguments_than_there_are_slots() {
    for row in SIGNATURES_WIN64 {
        let indirect = row.params.iter().filter(|param| param.starts_with("ptr dead_on_return")).count();
        assert!(
            indirect <= nts_codegen_llvm::WIN64_INDIRECT_SLOTS,
            "`{}` takes {indirect} sixteen-byte values by copy; raise `indirect::SLOTS`",
            row.name
        );
    }
}

/// The same for `x86_64` Windows. Skips without zig, whose mingw headers are
/// the ones the runtime is compiled against there; the gate has it.
#[test]
fn the_win64_table_still_matches_the_header() {
    let Some(flags) = win64_flags() else {
        eprintln!("SKIP: no zig, so no mingw headers to ask clang with");
        return;
    };
    check(&WIN64, &flags);
}

/// The same for arm64. Skips without the macOS SDK, which the Apple lane syncs.
#[test]
fn the_arm64_table_still_matches_the_header() {
    let Some(flags) = arm64_flags() else {
        eprintln!("SKIP: no macOS SDK to ask clang with (tooling/apple/sync-sdk.sh)");
        return;
    };
    check(&ARM64, &flags);
}

fn check(table: &Table, flags: &[String]) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let Some(fresh) = from_clang(&root, flags) else {
        eprintln!("SKIP: clang or the runtime header is unavailable");
        return;
    };
    if std::env::var_os("NTS_REGENERATE").is_some() {
        regenerate(&root, &fresh, table);
        return;
    }
    for declared in &fresh {
        let name = &declared.name;
        let Some(known) = table.rows.iter().find(|known| known.name == *name) else {
            // A helper the backend *reaches for* must be here. Missing, its
            // call is emitted with no declaration and no argument conversion --
            // an invalid module, not a refusal. Anything else the table does
            // not carry is a refusal, which is fine.
            assert!(
                !nts_codegen_llvm::ALWAYS_DECLARED.contains(&name.as_str()),
                "`{name}` is reached for by the backend but missing from the table; \
                 rerun with NTS_REGENERATE=1"
            );
            continue;
        };
        assert_eq!(
            known.returns, declared.returns,
            "`{name}` returns something else now; rerun with NTS_REGENERATE=1"
        );
        let carried: Vec<String> = known.params.iter().map(|p| (*p).to_owned()).collect();
        assert_eq!(
            &carried, &declared.params,
            "`{name}` takes something else now; rerun with NTS_REGENERATE=1"
        );
        let promised: Vec<String> = known.attributes.iter().map(|a| (*a).to_owned()).collect();
        assert_eq!(
            &promised, &declared.attributes,
            "`{name}` promises something else now; rerun with NTS_REGENERATE=1.\n\
             An attribute is what lets a call be hoisted or dropped, so one that \
             appears or disappears silently is a performance or a correctness \
             change with every other test still green."
        );
    }
    // And the other way: a runtime row clang no longer reports is a helper the
    // header stopped declaring. Carried here, it is emitted as a call to a
    // symbol whose signature nothing checks any more -- which is how three
    // hand-added rows outlived their declarations, and why regenerating would
    // have deleted two the backend calls.
    for known in table.rows.iter().filter(|known| known.name.starts_with("nts_")) {
        assert!(
            fresh.iter().any(|declared| declared.name == known.name),
            "`{}` is in {} but the header no longer declares it; declare it or rerun with NTS_REGENERATE=1",
            known.name,
            table.file
        );
    }
    assert!(
        table.rows.len() > 100,
        "{} looks empty: {} entries",
        table.file,
        table.rows.len()
    );
}
