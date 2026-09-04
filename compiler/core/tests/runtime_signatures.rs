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

/// One helper as clang reports it: name, parameters, result.
type Reported = (String, Vec<Option<HirType>>, Option<HirType>);

/// Every `nts_` function the header declares, with its C types.
fn from_clang(root: &std::path::Path) -> Option<Vec<Reported>> {
    let header = root.join("runtime/c/nts_runtime.h");
    let dir = std::env::temp_dir().join(format!("nts-runtime-sigs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::copy(&header, dir.join("nts_runtime.h")).ok()?;
    std::fs::write(dir.join("probe.c"), "#include \"nts_runtime.h\"\n").ok()?;

    let output = std::process::Command::new("clang")
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
        let inside = signature[paren + 1..].trim_end_matches(')');
        let params: Vec<Option<HirType>> = if inside.trim().is_empty() || inside.trim() == "void" {
            Vec::new()
        } else {
            inside.split(',').map(scalar).collect()
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
    let Some(fresh) = from_clang(&root) else {
        eprintln!("SKIP: clang or the runtime header is unavailable");
        return;
    };
    let mut checked = 0;
    for (name, params, returns) in &fresh {
        let Some(known) = runtime::parameters(name) else {
            // A helper the table does not carry is one the middle end will not
            // convert for. That is conservative -- the backend still adapts --
            // rather than wrong.
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
    eprintln!("checked {checked} helpers against the header");
    assert!(checked > 80, "only {checked} helpers checked; the parse is wrong");
}
