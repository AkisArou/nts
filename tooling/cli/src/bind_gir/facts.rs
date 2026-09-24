//! What only the headers know about a C type name: the struct it is, and
//! for an enum, whether C made it signed.
//!
//! **The tag.** A handle is spelled `struct <tag> *`, and GIR names types, not
//! tags. The convention -- `typedef struct _GtkWidget GtkWidget` -- holds for
//! most of GTK and fails where it matters: `GdkRectangle` is cairo's
//! `struct _cairo_rectangle_int`, and `GInitiallyUnowned` is `struct _GObject`.
//! Each type is declared as an `extern` object of that type -- legal for an
//! incomplete struct -- and clang's AST dump prints the declaration's type
//! desugared: `'GtkWidget':'struct _GtkWidget'`.
//!
//! **The sign.** An enum's compatible integer type is C's choice and GIR's
//! values do not settle it: `G_PARAM_DEPRECATED` is `(gint)(1u << 31)` in the
//! header and `2147483648` in GIR, and a `GParamFlags` declared
//! `unsigned int` conflicts with every function taking one. The enumerator
//! `((GParamFlags)-1 < 0)` is a constant expression the compiler that owns
//! the header evaluates, and the dump reports its value.
//!
//! One clang run per namespace for both, filtered to its own declarations by a
//! prefix nothing in a real header uses.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use anyhow::{Context, Result};

const PREFIX: &str = "ntsbindgir_";

/// Calls so far, which name each call's scratch directory.
static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// What the headers said.
#[derive(Debug, Default)]
pub(crate) struct Facts {
    /// `c_type -> tag` for every name the headers define as a tagged struct.
    pub(crate) tags: BTreeMap<String, String>,
    /// The enum types C made signed. An enum type absent from here and from
    /// `unsigned` was not answered, and the caller falls back to GIR's values.
    pub(crate) signed: BTreeSet<String>,
    pub(crate) unsigned: BTreeSet<String>,
    /// `interface C type -> the C type every instance of it also is`, from
    /// the type system (`super::prerequisites`), for the interfaces GIR gives
    /// no prerequisite.
    pub(crate) prerequisites: BTreeMap<String, String>,
}

/// Ask the headers about `structs` and `enums`, which are C type names.
pub(crate) fn resolve(headers: &[String], structs: &[&str], enums: &[&str], cflags: &[String]) -> Result<Facts> {
    if structs.is_empty() && enums.is_empty() {
        return Ok(Facts::default());
    }
    let mut probe = String::new();
    for header in headers {
        let _ = writeln!(probe, "#include <{header}>");
    }
    for (at, c_type) in structs.iter().enumerate() {
        let _ = writeln!(probe, "extern {c_type} {PREFIX}tag_{at};");
    }
    for (at, c_type) in enums.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}sign_{at} = (({c_type})-1 < 0) }};");
    }
    // One directory per call, since namespaces are read at once.
    let call = CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("nts-bind-gir-facts-{}-{call}", std::process::id()));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = dir.join("facts.c");
    std::fs::write(&path, probe).with_context(|| format!("writing {}", path.display()))?;
    // Errors are expected and harmless here: a name the headers do not
    // declare is an invalid declaration, and is simply absent from the answer.
    let output = std::process::Command::new(std::env::var("CC").unwrap_or_else(|_| "clang".to_owned()))
        .args(["-std=c11", "-fsyntax-only", "-w", "-fno-color-diagnostics", "-ferror-limit=0"])
        .args(cflags)
        .args(["-Xclang", "-ast-dump", "-Xclang", "-ast-dump-filter", "-Xclang", PREFIX])
        .arg(&path)
        .output()
        .context("running clang to read what the headers define")?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(parse(&String::from_utf8_lossy(&output.stdout), structs, enums))
}

/// Read the dump back: `VarDecl ... <prefix>tag_<n> '<T>':'struct <tag>'`,
/// and `EnumConstantDecl ... <prefix>sign_<n>` with `value: Int <v>` under its
/// `ConstantExpr`. The test's dump is clang's own output, copied: the first
/// version of it put the value on the next line, which is where this parser
/// looked, and clang does not.
fn parse(dump: &str, structs: &[&str], enums: &[&str]) -> Facts {
    let mut facts = Facts::default();
    let mut lines = dump.lines().peekable();
    while let Some(line) = lines.next() {
        if line.contains("VarDecl") && !line.contains(" invalid ") {
            let Some(rest) = line.split_once(&format!(" {PREFIX}tag_")).map(|(_, rest)| rest) else { continue };
            let Some((index, types)) = rest.split_once(' ') else { continue };
            let Some(c_type) = index.parse::<usize>().ok().and_then(|n| structs.get(n)) else { continue };
            // `'GtkWidget':'struct _GtkWidget'`, or `'struct _X'` alone when
            // the name already was the struct.
            let quoted: Vec<&str> = types.split('\'').skip(1).step_by(2).collect();
            if let Some(tag) = quoted.last().and_then(|t| t.strip_prefix("struct ")) {
                facts.tags.insert((*c_type).to_owned(), tag.trim().to_owned());
            }
        } else if line.contains("EnumConstantDecl") && !line.contains(" invalid ") {
            let Some(rest) = line.split_once(&format!(" {PREFIX}sign_")).map(|(_, rest)| rest) else { continue };
            let Some(c_type) = rest.split(' ').next().and_then(|n| n.parse::<usize>().ok()).and_then(|n| enums.get(n)) else {
                continue;
            };
            // The value sits under the initialiser's `ConstantExpr`, a line or
            // two down, before the next declaration.
            let mut value = None;
            while let Some(next) = lines.peek() {
                if next.contains("Decl ") && !next.contains("Expr") {
                    break;
                }
                let next = lines.next().unwrap_or_default();
                if let Some((_, v)) = next.split_once("value: Int ") {
                    value = Some(v.trim());
                    break;
                }
            }
            let Some(value) = value else { continue };
            match value {
                "1" => facts.signed.insert((*c_type).to_owned()),
                "0" => facts.unsigned.insert((*c_type).to_owned()),
                _ => false,
            };
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    /// Clang's text dump, as it prints each case: a conventional tag, a typedef
    /// of another library's struct, a name already naming the struct, a type
    /// the headers do not declare, and a signed and an unsigned enum.
    #[test]
    fn a_dump_reads_back_as_facts() {
        let dump = "\
VarDecl 0x1 <t.c:2:1, col:19> col:19 ntsbindgir_tag_0 'GtkWidget':'struct _GtkWidget' extern
VarDecl 0x2 <t.c:3:1, col:22> col:22 ntsbindgir_tag_1 'GdkRectangle':'struct _cairo_rectangle_int' extern
VarDecl 0x3 <t.c:4:1, col:22> col:22 ntsbindgir_tag_2 'struct _Plain' extern
VarDecl 0x4 <t.c:5:1, col:20> col:20 invalid ntsbindgir_tag_3 'int' extern
EnumConstantDecl 0x5 <t.c:6:8, col:47> col:8 ntsbindgir_sign_0 'int'
`-ConstantExpr 0x7 <col:28, col:48> 'int'
  |-value: Int 1
  `-ParenExpr 0x8 <col:28, col:48> 'int'
EnumConstantDecl 0x6 <t.c:7:8, col:44> col:8 ntsbindgir_sign_1 'int'
`-ConstantExpr 0x9 <col:28, col:48> 'int'
  |-value: Int 0
";
        let facts = super::parse(
            dump,
            &["GtkWidget", "GdkRectangle", "struct _Plain", "NoSuchType"],
            &["GParamFlags", "GtkAlign"],
        );
        assert_eq!(facts.tags["GtkWidget"], "_GtkWidget");
        assert_eq!(facts.tags["GdkRectangle"], "_cairo_rectangle_int");
        assert_eq!(facts.tags["struct _Plain"], "_Plain");
        assert!(!facts.tags.contains_key("NoSuchType"));
        assert!(facts.signed.contains("GParamFlags"));
        assert!(facts.unsigned.contains("GtkAlign"));
    }
}
