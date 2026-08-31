//! The generated signature table, checked against clang.
//!
//! `src/signatures.rs` is generated from `runtime/c/nts_runtime.h` and checked
//! in, which is only safe while something notices when it drifts. This is that
//! something: it asks clang for the header's declarations again and compares.
//!
//! It exists because the alternative failed. Reading a helper's signature off
//! the *call site* is sound only where the lowering's types and the runtime's
//! already agree, and `nts_tag_name` takes a `uint32_t` where the lowering
//! hands it a double -- C converts implicitly at the call and the C backend
//! never had to notice. The declared double went into an SSE register, the
//! callee read an integer one, and `typeof v` answered "undefined" for a
//! number.
//!
//! Skips rather than fails without clang, like every other test here that needs
//! a toolchain.

use std::fmt::Write as _;

use nts_codegen_llvm::signatures::SIGNATURES;

/// Reference every runtime function so clang has to declare it, then read the
/// declarations back.
fn from_clang(root: &std::path::Path) -> Option<Vec<(String, String, Vec<String>)>> {
    let header = root.join("runtime/c/nts_runtime.h");
    let text = std::fs::read_to_string(&header).ok()?;
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        // A declaration, not a `static inline` definition: the second has no
        // symbol for anything to link against, which is the whole distinction
        // this table exists to respect.
        let trimmed = line.trim_start();
        if trimmed.starts_with("static") || !line.contains("nts_") || !line.contains('(') {
            continue;
        }
        let Some(open) = line.find('(') else { continue };
        let before = &line[..open];
        let Some(start) = before.rfind(|c: char| !(c.is_alphanumeric() || c == '_')) else {
            continue;
        };
        let name = &before[start + 1..];
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
    if names.is_empty() {
        return None;
    }

    let dir = std::env::temp_dir().join(format!("nts-sigs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::copy(&header, dir.join("nts_runtime.h")).ok()?;
    let mut source = String::from("#include \"nts_runtime.h\"\nvoid *nts_all[] = {\n");
    for name in &names {
        let _ = writeln!(source, "  (void *){name},");
    }
    source.push_str("};\n");
    std::fs::write(dir.join("all.c"), source).ok()?;

    let output = std::process::Command::new("clang")
        .args(["-S", "-emit-llvm", "-O0", "-w", "-I"])
        .arg(&dir)
        .arg(dir.join("all.c"))
        .arg("-o")
        .arg("-")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let ir = String::from_utf8_lossy(&output.stdout);
    let mut found: Vec<(String, String, Vec<String>)> = Vec::new();
    for line in ir.lines() {
        let Some(rest) = line.strip_prefix("declare ") else {
            continue;
        };
        let Some(at) = rest.find('@') else { continue };
        let returns = rest[..at].replace("noundef", "");
        let after = &rest[at + 1..];
        let Some(open) = after.find('(') else { continue };
        let name = after[..open].to_owned();
        let Some(close) = after.rfind(')') else { continue };
        let params: Vec<String> = after[open + 1..close]
            .split(',')
            .map(|part| part.replace("noundef", "").split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|part| !part.is_empty())
            .collect();
        found.push((name, returns.split_whitespace().collect::<Vec<_>>().join(" "), params));
    }
    found.sort();
    Some(found)
}

#[test]
fn the_table_still_matches_the_header() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let Some(fresh) = from_clang(&root) else {
        eprintln!("SKIP: clang or the runtime header is unavailable");
        return;
    };
    for (name, returns, params) in &fresh {
        let Some(known) = SIGNATURES.iter().find(|known| known.name == name) else {
            // A function the table does not carry is one the backend cannot
            // call, which is a refusal rather than a wrong call. Not an error.
            continue;
        };
        assert_eq!(
            known.returns, returns,
            "`{name}` returns something else now; regenerate src/signatures.rs"
        );
        let carried: Vec<String> = known.params.iter().map(|p| (*p).to_owned()).collect();
        assert_eq!(
            &carried, params,
            "`{name}` takes something else now; regenerate src/signatures.rs"
        );
    }
    assert!(
        SIGNATURES.len() > 100,
        "the table looks empty: {} entries",
        SIGNATURES.len()
    );
}
