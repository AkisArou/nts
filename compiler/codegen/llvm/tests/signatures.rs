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

use nts_codegen_llvm::signatures::SIGNATURES;

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
    text.replace("noundef", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Reference every runtime function so clang has to declare it, then read the
/// declarations back.
fn from_clang(root: &std::path::Path) -> Option<Vec<Declared>> {
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
fn regenerate(root: &std::path::Path, fresh: &[Declared]) {
    const OPEN: &str = "pub const SIGNATURES: &[Signature] = &[\n";
    const CLOSE: &str = "];\n";

    let path = root.join("compiler/codegen/llvm/src/signatures.rs");
    let text = std::fs::read_to_string(&path).expect("src/signatures.rs");
    let start = text.find(OPEN).expect("the table's opening") + OPEN.len();
    let end = start + text[start..].find(CLOSE).expect("the table's close");

    // Names the table already carries that clang did not report -- the LLVM
    // intrinsics the backend reaches for, which are not in the C header.
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
    std::fs::write(&path, out).expect("write src/signatures.rs");
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
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let Some(fresh) = from_clang(&root) else {
        eprintln!("SKIP: clang or the runtime header is unavailable");
        return;
    };
    if std::env::var_os("NTS_REGENERATE").is_some() {
        regenerate(&root, &fresh);
        return;
    }
    for declared in &fresh {
        let name = &declared.name;
        let Some(known) = SIGNATURES.iter().find(|known| known.name == *name) else {
            // A function the table does not carry is one the backend cannot
            // call, which is a refusal rather than a wrong call. Not an error.
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
    assert!(
        SIGNATURES.len() > 100,
        "the table looks empty: {} entries",
        SIGNATURES.len()
    );
}
