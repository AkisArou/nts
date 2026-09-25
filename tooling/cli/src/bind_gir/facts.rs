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
    /// `(class struct, member) -> offset`: where each virtual function's slot
    /// is, which a subclass's registration writes an entry point at. C's
    /// `offsetof`, so no struct's layout is worked out here.
    pub(crate) offsets: BTreeMap<(String, String), u64>,
    /// `C type -> sizeof` for each boxed record whose struct the headers
    /// complete: the storage a caller allocates for C to fill. A record the
    /// headers keep opaque (`GBytes`) has none, and nothing allocates one.
    pub(crate) sizes: BTreeMap<String, u64>,
    /// The functions asked about that the namespace's own headers declare: a
    /// boxed record's `get_type`, without which the program cannot box it.
    /// `GLib`'s records name functions only `GObject`'s headers declare
    /// (`g_date_time_get_type`), so GIR's word is not enough.
    pub(crate) declared: BTreeSet<String>,
}

impl Facts {
    /// Another namespace's facts added to these: each is keyed by C name, and
    /// no two namespaces define one.
    pub(crate) fn merge(&mut self, other: Facts) {
        self.tags.extend(other.tags);
        self.signed.extend(other.signed);
        self.unsigned.extend(other.unsigned);
        self.prerequisites.extend(other.prerequisites);
        self.offsets.extend(other.offsets);
        self.sizes.extend(other.sizes);
        self.declared.extend(other.declared);
    }
}

/// Ask the headers about `structs` and `enums`, which are C type names.
pub(crate) fn resolve(
    headers: &[String],
    structs: &[&str],
    enums: &[&str],
    slots: &[(String, String)],
    sized: &[&str],
    functions: &[&str],
    cflags: &[String],
) -> Result<Facts> {
    if structs.is_empty() && enums.is_empty() && slots.is_empty() && sized.is_empty() && functions.is_empty() {
        return Ok(Facts::default());
    }
    let mut probe = String::new();
    for header in headers {
        let _ = writeln!(probe, "#include <{header}>");
    }
    probe.push_str("#include <stddef.h>\n");
    for (at, (class_struct, member)) in slots.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}offset_{at} = (int)offsetof({class_struct}, {member}) }};");
    }
    for (at, c_type) in sized.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}size_{at} = (int)sizeof({c_type}) }};");
    }
    for (at, function) in functions.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}declared_{at} = (int)sizeof(&{function}) }};");
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
        // No spelling correction: clang recovers from an undeclared name by
        // using the one it guesses was meant -- `g_date_time_get_type` became
        // `g_date_time_get_ymd` -- and the enumerator asking about it then
        // reads as valid, answering for a function the headers never declare.
        .args(["-std=c11", "-fsyntax-only", "-w", "-fno-color-diagnostics", "-ferror-limit=0", "-fno-spell-checking"])
        .args(cflags)
        .args(["-Xclang", "-ast-dump", "-Xclang", "-ast-dump-filter", "-Xclang", PREFIX])
        .arg(&path)
        .output()
        .context("running clang to read what the headers define")?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(parse(&String::from_utf8_lossy(&output.stdout), &Asked { structs, enums, slots, sized, functions }))
}

/// Read the dump back: `VarDecl ... <prefix>tag_<n> '<T>':'struct <tag>'`,
/// and `EnumConstantDecl ... <prefix>sign_<n>` with `value: Int <v>` under its
/// `ConstantExpr`. The test's dump is clang's own output, copied: the first
/// version of it put the value on the next line, which is where this parser
/// looked, and clang does not.
/// What one probe asked the headers, by kind: each answer's index is into
/// the list of its kind.
struct Asked<'a> {
    structs: &'a [&'a str],
    enums: &'a [&'a str],
    slots: &'a [(String, String)],
    sized: &'a [&'a str],
    functions: &'a [&'a str],
}

fn parse(dump: &str, asked: &Asked<'_>) -> Facts {
    let Asked { structs, enums, slots, sized, functions } = *asked;
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
            let index = |kind: &str| {
                line.split_once(&format!(" {PREFIX}{kind}_"))
                    .and_then(|(_, rest)| rest.split(' ').next())
                    .and_then(|n| n.parse::<usize>().ok())
            };
            if let Some(slot) = index("offset").and_then(|n| slots.get(n)) {
                if let Some(offset) = enumerator_value(&mut lines).and_then(|v| v.parse().ok()) {
                    facts.offsets.insert(slot.clone(), offset);
                }
                continue;
            }
            // Declared only where the `sizeof` evaluated: after an error clang
            // can still dump the enumerator, unmarked, with no value.
            if let Some(function) = index("declared").and_then(|n| functions.get(n)) {
                if enumerator_value(&mut lines).is_some_and(|v| v != "0") {
                    facts.declared.insert((*function).to_owned());
                }
                continue;
            }
            if let Some(c_type) = index("size").and_then(|n| sized.get(n)) {
                if let Some(size) = enumerator_value(&mut lines).and_then(|v| v.parse().ok()) {
                    facts.sizes.insert((*c_type).to_owned(), size);
                }
                continue;
            }
            let Some(c_type) = index("sign").and_then(|n| enums.get(n)) else { continue };
            match enumerator_value(&mut lines) {
                Some("1") => facts.signed.insert((*c_type).to_owned()),
                Some("0") => facts.unsigned.insert((*c_type).to_owned()),
                _ => false,
            };
        }
    }
    facts
}

/// An enumerator's value, which sits under its initialiser's `ConstantExpr`
/// a line or two down, before the next declaration.
fn enumerator_value<'d>(lines: &mut std::iter::Peekable<std::str::Lines<'d>>) -> Option<&'d str> {
    while let Some(next) = lines.peek() {
        if next.contains("Decl ") && !next.contains("Expr") {
            return None;
        }
        let next = lines.next().unwrap_or_default();
        if let Some((_, v)) = next.split_once("value: Int ") {
            return Some(v.trim());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    /// Clang's text dump, as it prints each case: a conventional tag, a typedef
    /// of another library's struct, a name already naming the struct, a type
    /// the headers do not declare, a signed and an unsigned enum, and a slot's
    /// offset -- one found, and one whose member the struct does not have.
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
EnumConstantDecl 0xa <t.c:8:8, col:60> col:8 ntsbindgir_offset_0 'int'
`-ConstantExpr 0xb <col:28, col:60> 'int'
  |-value: Int 424
  `-CStyleCastExpr 0xc <col:28, col:60> 'int' <IntegralCast>
EnumConstantDecl 0xd <t.c:9:8, col:60> col:8 invalid ntsbindgir_offset_1 'int'
EnumConstantDecl 0xe <t.c:10:8, col:50> col:8 ntsbindgir_size_0 'int'
`-ConstantExpr 0xf <col:28, col:50> 'int'
  |-value: Int 80
EnumConstantDecl 0x10 <t.c:11:8, col:50> col:8 invalid ntsbindgir_size_1 'int'
EnumConstantDecl 0x11 <t.c:12:8, col:50> col:8 ntsbindgir_declared_0 'int'
`-ConstantExpr 0x12 <col:28, col:50> 'int'
  |-value: Int 8
EnumConstantDecl 0x13 <t.c:13:8, col:50> col:8 ntsbindgir_declared_1 'int'
`-RecoveryExpr 0x14 <col:28, col:50> 'int' contains-errors
";
        let slots = [
            ("GtkButtonClass".to_owned(), "clicked".to_owned()),
            ("GtkButtonClass".to_owned(), "no_such_member".to_owned()),
        ];
        let facts = super::parse(
            dump,
            &super::Asked {
                structs: &["GtkWidget", "GdkRectangle", "struct _Plain", "NoSuchType"],
                enums: &["GParamFlags", "GtkAlign"],
                slots: &slots,
                sized: &["GtkTextIter", "GBytes"],
                functions: &["gtk_text_iter_get_type", "g_date_time_get_type"],
            },
        );
        assert!(facts.declared.contains("gtk_text_iter_get_type"));
        assert!(!facts.declared.contains("g_date_time_get_type"), "an undeclared function was answered");
        assert_eq!(facts.sizes["GtkTextIter"], 80);
        assert!(!facts.sizes.contains_key("GBytes"), "an opaque record was given a size");
        assert_eq!(facts.offsets[&slots[0]], 424);
        assert!(!facts.offsets.contains_key(&slots[1]), "an invalid offsetof answered");
        assert_eq!(facts.tags["GtkWidget"], "_GtkWidget");
        assert_eq!(facts.tags["GdkRectangle"], "_cairo_rectangle_int");
        assert_eq!(facts.tags["struct _Plain"], "_Plain");
        assert!(!facts.tags.contains_key("NoSuchType"));
        assert!(facts.signed.contains("GParamFlags"));
        assert!(facts.unsigned.contains("GtkAlign"));
    }
}
