//! The generated runtime signature table, checked against the C header.
//!
//! `src/hir/runtime.rs` says what the C runtime declares its parameters and
//! results to be, and the middle end inserts conversions from it. A table that
//! has drifted would insert the *wrong* conversion, which is a wrong answer
//! rather than a build failure -- `fptoui` where `fptosi` belongs reads
//! 4294967295 as -1.
//!
//! So it is checked against clang, the same way `nts-codegen-llvm` checks its
//! own. That one reads LLVM types and this one reads C types, because LLVM's
//! carry no signedness: `i32` is `int32_t` and `uint32_t` both.
//!
//! Skips without clang. *Fails* when clang runs and refuses, because that is a
//! broken header rather than a missing tool.

use nts_core::hir::{runtime, HirType};

/// What a C type name means as a representation, or `None` when it is not a
/// scalar -- a pointer or an `NtsValue`, neither of which is converted.
fn scalar(spelling: &str) -> Option<HirType> {
    Some(match spelling.trim() {
        "double" => HirType::Float { bits: 64 },
        "float" => HirType::Float { bits: 32 },
        "bool" | "_Bool" => HirType::Bool,
        "int8_t" => HirType::Int { bits: 8, signed: true },
        "uint8_t" => HirType::Int { bits: 8, signed: false },
        "int16_t" => HirType::Int { bits: 16, signed: true },
        "uint16_t" => HirType::Int { bits: 16, signed: false },
        "int32_t" => HirType::Int { bits: 32, signed: true },
        "uint32_t" => HirType::Int { bits: 32, signed: false },
        "int64_t" => HirType::Int { bits: 64, signed: true },
        "uint64_t" | "size_t" => HirType::Int { bits: 64, signed: false },
        "__int128" => HirType::BigInt,
        _ => return None,
    })
}

/// A parameter list split at its own commas, not those inside a parameter's
/// parentheses: `void (*)(const void *, void *)` is one parameter, and was
/// read as two once a helper took a callback (`nts_block_carry`).
fn top_level(list: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0usize, 0usize);
    for (at, character) in list.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&list[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&list[start..]);
    parts
}

/// One helper as clang reports it: name, parameters, result.
type Reported = (String, Vec<Option<HirType>>, Option<HirType>);

/// clang's flags for `x86_64` Windows against zig's mingw headers, where the
/// helpers under `#if defined(_WIN32)` are declared. `None` without zig.
fn windows_flags() -> Option<Vec<String>> {
    let env = std::process::Command::new("zig").arg("env").output().ok()?;
    let text = String::from_utf8_lossy(&env.stdout);
    let lib = text.lines().find_map(|line| line.trim().strip_prefix(".lib_dir = \"")?.strip_suffix("\","))?;
    let headers = std::path::Path::new(lib).join("libc/include");
    let mut flags = vec!["--target=x86_64-w64-windows-gnu".to_owned(), "-nostdlibinc".to_owned()];
    for directory in ["x86_64-windows-gnu", "generic-mingw", "x86_64-windows-any", "any-windows-any"] {
        flags.push("-isystem".to_owned());
        flags.push(headers.join(directory).to_string_lossy().into_owned());
    }
    Some(flags)
}

/// Every `nts_` function the header declares for the target `flags` name,
/// with its C types.
fn from_clang(root: &std::path::Path, flags: &[String]) -> Option<Vec<Reported>> {
    let header = root.join("runtime/c/nts_runtime.h");
    let dir = std::env::temp_dir().join(format!("nts-runtime-sigs-{}-{}", std::process::id(), flags.len()));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::copy(&header, dir.join("nts_runtime.h")).ok()?;
    std::fs::write(dir.join("probe.c"), "#include \"nts_runtime.h\"\n").ok()?;

    let output = std::process::Command::new("clang")
        .args(flags)
        .args(["-Xclang", "-ast-dump", "-fsyntax-only", "-I"])
        .arg(&dir)
        .arg(dir.join("probe.c"))
        .output()
        .ok()?;
    assert!(
        output.status.success(),
        "clang refused the header:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let dump = String::from_utf8_lossy(&output.stdout);
    let mut found = Vec::new();
    for line in dump.lines() {
        let Some(at) = line.find("FunctionDecl ") else {
            continue;
        };
        // `FunctionDecl 0x… <…> … name 'returns (params)'`
        let rest = &line[at..];
        let Some(open) = rest.find(" '") else { continue };
        let Some(close) = rest.rfind('\'') else { continue };
        if close <= open + 2 {
            continue;
        }
        let name = rest[..open].split_whitespace().last().unwrap_or("");
        if !name.starts_with("nts_") {
            continue;
        }
        let signature = &rest[open + 2..close];
        let Some(paren) = signature.find('(') else { continue };
        let returns = scalar(&signature[..paren]);
        // The list's own closing parenthesis only: a function-pointer
        // parameter (`void (*run)(const void *, void *)`) ends in one too.
        let inside = signature[paren + 1..].strip_suffix(')').unwrap_or(&signature[paren + 1..]);
        let params: Vec<Option<HirType>> = if inside.trim().is_empty() || inside.trim() == "void" {
            Vec::new()
        } else {
            top_level(inside).into_iter().map(scalar).collect()
        };
        if params.iter().all(Option::is_none) && returns.is_none() {
            continue;
        }
        found.push((name.to_owned(), params, returns));
    }
    (!found.is_empty()).then_some(found)
}

#[test]
fn the_table_still_matches_the_header() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let Some(mut fresh) = from_clang(&root, &[]) else {
        eprintln!("SKIP: clang or the runtime header is unavailable");
        return;
    };
    // And what only Windows declares (`#if defined(_WIN32)`): the table is the
    // middle end's, which is the same for every target, so it carries both.
    let host: Vec<String> = fresh.iter().map(|(name, _, _)| name.clone()).collect();
    match windows_flags().and_then(|flags| from_clang(&root, &flags)) {
        Some(windows) => {
            for (name, params, returns) in windows {
                if host.contains(&name) {
                    continue;
                }
                // **A Windows-only helper taking a scalar must be here**, since
                // nothing on the host notices it missing. Absent, the middle end
                // converts its arguments as it would a `number`:
                // `nts_hresult_message(int32_t)` was handed a `double`, which
                // C's implicit conversion put right and LLVM passed in the
                // wrong register.
                assert!(
                    params.iter().all(Option::is_none) || runtime::parameters(&name).is_some(),
                    "`{name}` is declared only for Windows, takes a scalar, and is not in src/hir/runtime.rs"
                );
                fresh.push((name, params, returns));
            }
        }
        None => eprintln!("SKIP the Windows-only helpers: no zig for mingw headers"),
    }
    let mut checked = 0;
    let mut unrowed_wide = Vec::new();
    for (name, params, returns) in &fresh {
        let Some(known) = runtime::parameters(name) else {
            // A helper the table does not carry has its scalar arguments
            // converted as numbers, which is right only for a `double` -- and
            // for a 64-bit integer is a rounding through 53 bits, since a
            // declared helper is the only kind `specialize` passes an integer
            // to exactly (MemoryBuffer's factory IID word arrived rounded,
            // and Windows answered E_NOINTERFACE). So one of those must have
            // a row; a narrower parameter's absence still costs a register on
            // LLVM but not the value.
            if params.iter().flatten().any(|ty| matches!(ty, HirType::Int { bits: 64, .. })) {
                unrowed_wide.push(name.clone());
            }
            continue;
        };
        assert_eq!(
            known, params.as_slice(),
            "`{name}` takes something else now; regenerate src/hir/runtime.rs"
        );
        assert_eq!(
            runtime::result(name), returns.as_ref(),
            "`{name}` returns something else now; regenerate src/hir/runtime.rs"
        );
        checked += 1;
    }
    assert!(
        unrowed_wide.is_empty(),
        "helpers taking a 64-bit integer with no row in src/hir/runtime.rs, so the value rounds through a double: {unrowed_wide:?}"
    );
    eprintln!("checked {checked} helpers against the header");
    assert!(checked > 80, "only {checked} helpers checked; the parse is wrong");
}

/// `runtime::READS_ONLY` names exactly the helpers the header marks.
///
/// Two lists again, and the failure this prevents is the quiet one: a helper
/// that loses `NTS_READS_ONLY` in the header while staying on this list makes
/// `own::quiet` answer that a call which *can* store is one a borrow survives —
/// and the result is a use after free that no answer would differ over, because
/// the object is usually still there.
///
/// The other direction is only a missed elision, which is why the message says
/// which way it went.
#[test]
fn the_read_only_helpers_are_the_ones_the_header_marks() {
    let header = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../runtime/c/nts_runtime.h");
    let Ok(text) = std::fs::read_to_string(header) else {
        return;
    };
    let mut marked: Vec<&str> = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim_start().strip_prefix("NTS_READS_ONLY ") else {
            continue;
        };
        // The declaration's name is the token before the parameter list.
        let Some(open) = rest.find('(') else { continue };
        let before = &rest[..open];
        let name = before
            .rsplit(|c: char| !(c.is_alphanumeric() || c == '_'))
            .next()
            .unwrap_or("");
        if name.starts_with("nts_") {
            marked.push(name);
        }
    }
    marked.sort_unstable();

    let mut ours: Vec<&str> = runtime::READS_ONLY.to_vec();
    ours.sort_unstable();

    for name in &ours {
        assert!(
            marked.contains(name),
            "`{name}` is on `runtime::READS_ONLY` and the header does not mark it \
             `NTS_READS_ONLY` -- a borrow is being kept across a call that may store"
        );
    }
    for name in &marked {
        assert!(
            ours.contains(name),
            "the header marks `{name}` `NTS_READS_ONLY` and `runtime::READS_ONLY` \
             does not list it -- a missed elision rather than a hazard, but the two \
             lists are meant to be one fact"
        );
    }
}
