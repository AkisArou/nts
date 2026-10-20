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

use crate::bind_header::ctype::{self, CType};
use crate::bind_header::probe::Probe;

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
    /// `macro -> value` for each macro asked about that the headers define
    /// as an integer constant expression: a fundamental `GType`
    /// (`G_TYPE_STRING` is `G_TYPE_MAKE_FUNDAMENTAL (16)`, 64), which GIR does
    /// not list. One defined as a call (`G_TYPE_GTYPE`) is no constant, and
    /// absent.
    pub(crate) macros: BTreeMap<String, i64>,
    /// `symbol -> C function type`, as the headers declare each callable: a
    /// function by its C identifier, a virtual function as
    /// `{class struct}_{member}`, the type its slot points at. GIR writes a
    /// C spelling for every parameter too, but drops a `const` the header
    /// has -- `g_output_stream_write`'s `const void *buffer` is GIR's `void*`
    /// -- so the header decides qualifiers and GIR what a parameter means.
    pub(crate) prototypes: BTreeMap<String, CType>,
    /// The callables whose declaration spells `volatile`, which no binding
    /// spells: `g_atomic_pointer_get (const volatile void *)`.
    pub(crate) volatile: BTreeSet<String>,
    /// `c_type -> what it points at`, for each pointer record (GIR's
    /// `pointer="1"`): `hb_language_t` is a `const struct
    /// hb_language_impl_t *`. Kept apart from `tags`, which a `T *` spelling
    /// reads as the handle: the pointer record spelled bare is the handle,
    /// and spelled `hb_language_t *` is a pointer to one.
    pub(crate) pointers: BTreeMap<String, PointerRecord>,
}

/// A pointer record's pointee, as its typedef says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PointerRecord {
    /// The struct the typedef points at.
    pub(crate) tag: String,
    /// Whether it points at it `const`.
    pub(crate) constant: bool,
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
        self.macros.extend(other.macros);
        self.prototypes.extend(other.prototypes);
        self.volatile.extend(other.volatile);
        self.pointers.extend(other.pointers);
    }
}

/// What each pointer record's typedef points at, from the headers through
/// the shared probe: one pointer level to a tagged struct, or no answer, and
/// the record keeps its refusal.
pub(crate) fn pointer_records(
    preamble: &[String],
    cflags: &[String],
    names: &[&str],
) -> Result<BTreeMap<String, PointerRecord>> {
    if names.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut clang_args = vec!["-std=c11".to_owned(), "-fno-spell-checking".to_owned()];
    clang_args.extend(cflags.iter().cloned());
    let probe = Probe {
        preamble,
        clang_args: &clang_args,
        prefix: PREFIX,
        label: "bind-gir",
    };
    let typedefs = probe.typedefs(names.iter().map(|name| (*name).to_owned()).collect())?;
    let mut pointers = BTreeMap::new();
    for name in names {
        let Some(text) = typedefs.get(*name) else {
            continue;
        };
        if let Ok(CType::Pointer { to, constant }) = ctype::parse(text, &typedefs)
            && let CType::Record { union: false, tag } = *to
        {
            pointers.insert((*name).to_owned(), PointerRecord { tag, constant });
        }
    }
    Ok(pointers)
}

/// Each callable's C function type, from the headers through the probe the
/// Windows binder asks with too: `functions` by name, and each
/// `(class struct, member)` slot as the function its member points at.
/// A declaration clang cannot answer, or whose type the reader does not
/// parse, is left out, and its callable keeps GIR's spellings.
pub(crate) fn prototypes(
    preamble: &[String],
    cflags: &[String],
    functions: &[&str],
    slots: &[(String, String)],
) -> Result<(BTreeMap<String, CType>, BTreeSet<String>)> {
    if functions.is_empty() && slots.is_empty() {
        return Ok(Default::default());
    }
    // No spelling correction, as in `resolve`.
    let mut clang_args = vec!["-std=c11".to_owned(), "-fno-spell-checking".to_owned()];
    clang_args.extend(cflags.iter().cloned());
    let probe = Probe {
        preamble,
        clang_args: &clang_args,
        prefix: PREFIX,
        label: "bind-gir",
    };
    let mut questions = String::new();
    for function in functions {
        let _ = writeln!(questions, "__typeof__({function}) {PREFIX}fn_{function};");
    }
    for (class_struct, member) in slots {
        let _ = writeln!(
            questions,
            "__typeof__(*(({class_struct} *)0)->{member}) {PREFIX}fn_{class_struct}_{member};"
        );
    }
    let mut spelled = BTreeMap::new();
    for answer in probe.ask(&questions)? {
        if let Some(name) = answer.name.strip_prefix(&format!("{PREFIX}fn_")) {
            spelled.insert(name.to_owned(), answer.desugared.unwrap_or(answer.qual));
        }
    }
    let typedefs = probe.typedefs(
        spelled
            .values()
            .flat_map(|text| ctype::typedef_names(text))
            .collect(),
    )?;
    let mut prototypes = BTreeMap::new();
    let mut volatile = BTreeSet::new();
    for (name, text) in spelled {
        if spells_volatile(&text, &typedefs) {
            volatile.insert(name);
        } else if let Ok(function @ CType::Function { .. }) = ctype::parse(&text, &typedefs) {
            prototypes.insert(name, function);
        }
    }
    Ok((prototypes, volatile))
}

/// Whether `volatile` is in `text`, or in a typedef it names, followed down.
/// The reader drops the qualifier, as the Windows binder needs it to, so it
/// is looked for before reading.
fn spells_volatile(text: &str, typedefs: &BTreeMap<String, String>) -> bool {
    let mut pending = vec![text];
    let mut seen = BTreeSet::new();
    while let Some(text) = pending.pop() {
        if text
            .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .any(|word| word == "volatile")
        {
            return true;
        }
        for name in ctype::typedef_names(text) {
            if let Some(next) = typedefs.get(&name)
                && seen.insert(name)
            {
                pending.push(next);
            }
        }
    }
    false
}

/// Ask the headers what `asked` wants to know.
pub(crate) fn resolve(preamble: &[String], asked: &Asked<'_>, cflags: &[String]) -> Result<Facts> {
    let Asked {
        structs,
        enums,
        slots,
        sized,
        functions,
        macros,
    } = *asked;
    if structs.is_empty()
        && enums.is_empty()
        && slots.is_empty()
        && sized.is_empty()
        && functions.is_empty()
        && macros.is_empty()
    {
        return Ok(Facts::default());
    }
    let mut probe = String::new();
    for line in preamble {
        let _ = writeln!(probe, "{line}");
    }
    probe.push_str("#include <stddef.h>\n");
    for (at, (class_struct, member)) in slots.iter().enumerate() {
        let _ = writeln!(
            probe,
            "enum {{ {PREFIX}offset_{at} = (int)offsetof({class_struct}, {member}) }};"
        );
    }
    for (at, c_type) in sized.iter().enumerate() {
        let _ = writeln!(
            probe,
            "enum {{ {PREFIX}size_{at} = (int)sizeof({c_type}) }};"
        );
    }
    for (at, function) in functions.iter().enumerate() {
        let _ = writeln!(
            probe,
            "enum {{ {PREFIX}declared_{at} = (int)sizeof(&{function}) }};"
        );
    }
    for (at, name) in macros.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}macro_{at} = (int)({name}) }};");
    }
    for (at, c_type) in structs.iter().enumerate() {
        let _ = writeln!(probe, "extern {c_type} {PREFIX}tag_{at};");
    }
    for (at, c_type) in enums.iter().enumerate() {
        let _ = writeln!(probe, "enum {{ {PREFIX}sign_{at} = (({c_type})-1 < 0) }};");
    }
    // One directory per call, since namespaces are read at once.
    let call = CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("nts-bind-gir-facts-{}-{call}", std::process::id()));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = dir.join("facts.c");
    std::fs::write(&path, probe).with_context(|| format!("writing {}", path.display()))?;
    // Errors are expected and harmless here: a name the headers do not
    // declare is an invalid declaration, and is simply absent from the answer.
    let output =
        std::process::Command::new(std::env::var("CC").unwrap_or_else(|_| "clang".to_owned()))
            // No spelling correction: clang recovers from an undeclared name by
            // using the one it guesses was meant -- `g_date_time_get_type` became
            // `g_date_time_get_ymd` -- and the enumerator asking about it then
            // reads as valid, answering for a function the headers never declare.
            .args([
                "-std=c11",
                "-fsyntax-only",
                "-w",
                "-fno-color-diagnostics",
                "-ferror-limit=0",
                "-fno-spell-checking",
            ])
            .args(cflags)
            .args([
                "-Xclang",
                "-ast-dump",
                "-Xclang",
                "-ast-dump-filter",
                "-Xclang",
                PREFIX,
            ])
            .arg(&path)
            .output()
            .context("running clang to read what the headers define")?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(parse(&String::from_utf8_lossy(&output.stdout), asked))
}

/// Read the dump back: `VarDecl ... <prefix>tag_<n> '<T>':'struct <tag>'`,
/// and `EnumConstantDecl ... <prefix>sign_<n>` with `value: Int <v>` under its
/// `ConstantExpr`. The test's dump is clang's own output, copied: the first
/// version of it put the value on the next line, which is where this parser
/// looked, and clang does not.
/// What one probe asked the headers, by kind: each answer's index is into
/// the list of its kind.
#[derive(Clone, Copy)]
pub(crate) struct Asked<'a> {
    /// C type names, for the struct each is.
    pub(crate) structs: &'a [&'a str],
    /// Enum types, for whether C made each signed.
    pub(crate) enums: &'a [&'a str],
    /// `(class struct, member)`, for each slot's offset.
    pub(crate) slots: &'a [(String, String)],
    /// Records, for each one's size.
    pub(crate) sized: &'a [&'a str],
    /// Functions, for whether the headers declare each.
    pub(crate) functions: &'a [&'a str],
    /// Macros, for each one's integer value.
    pub(crate) macros: &'a [&'a str],
}

fn parse(dump: &str, asked: &Asked<'_>) -> Facts {
    let Asked {
        structs,
        enums,
        slots,
        sized,
        functions,
        macros,
    } = *asked;
    let mut facts = Facts::default();
    let mut lines = dump.lines().peekable();
    while let Some(line) = lines.next() {
        if line.contains("VarDecl") && !line.contains(" invalid ") {
            let Some(rest) = line
                .split_once(&format!(" {PREFIX}tag_"))
                .map(|(_, rest)| rest)
            else {
                continue;
            };
            let Some((index, types)) = rest.split_once(' ') else {
                continue;
            };
            let Some(c_type) = index.parse::<usize>().ok().and_then(|n| structs.get(n)) else {
                continue;
            };
            // `'GtkWidget':'struct _GtkWidget'`, or `'struct _X'` alone when
            // the name already was the struct.
            let quoted: Vec<&str> = types.split('\'').skip(1).step_by(2).collect();
            if let Some(tag) = quoted.last().and_then(|t| t.strip_prefix("struct ")) {
                facts
                    .tags
                    .insert((*c_type).to_owned(), tag.trim().to_owned());
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
            if let Some(name) = index("macro").and_then(|n| macros.get(n)) {
                if let Some(value) = enumerator_value(&mut lines).and_then(|v| v.parse().ok()) {
                    facts.macros.insert((*name).to_owned(), value);
                }
                continue;
            }
            if let Some(c_type) = index("size").and_then(|n| sized.get(n)) {
                if let Some(size) = enumerator_value(&mut lines).and_then(|v| v.parse().ok()) {
                    facts.sizes.insert((*c_type).to_owned(), size);
                }
                continue;
            }
            let Some(c_type) = index("sign").and_then(|n| enums.get(n)) else {
                continue;
            };
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
                macros: &[],
            },
        );
        assert!(facts.declared.contains("gtk_text_iter_get_type"));
        assert!(
            !facts.declared.contains("g_date_time_get_type"),
            "an undeclared function was answered"
        );
        assert_eq!(facts.sizes["GtkTextIter"], 80);
        assert!(
            !facts.sizes.contains_key("GBytes"),
            "an opaque record was given a size"
        );
        assert_eq!(facts.offsets[&slots[0]], 424);
        assert!(
            !facts.offsets.contains_key(&slots[1]),
            "an invalid offsetof answered"
        );
        assert_eq!(facts.tags["GtkWidget"], "_GtkWidget");
        assert_eq!(facts.tags["GdkRectangle"], "_cairo_rectangle_int");
        assert_eq!(facts.tags["struct _Plain"], "_Plain");
        assert!(!facts.tags.contains_key("NoSuchType"));
        assert!(facts.signed.contains("GParamFlags"));
        assert!(facts.unsigned.contains("GtkAlign"));
    }

    /// A macro's value, where the headers define it as a constant
    /// expression (`G_TYPE_STRING`, `G_TYPE_MAKE_FUNDAMENTAL (16)`), and
    /// nothing where they define it as a call (`G_TYPE_GTYPE`): clang dumps
    /// that enumerator with no value, and the next one's is not taken for
    /// it. The dump is clang's, the two blocks in the order that asks it.
    #[test]
    fn a_macro_is_valued_only_where_it_is_constant() {
        let dump = "\
Dumping ntsbindgir_macro_1:
EnumConstantDecl 0x1 <facts.c:3:8> col:8 ntsbindgir_macro_1 'int'

Dumping ntsbindgir_macro_0:
EnumConstantDecl 0x1 <facts.c:2:8, col:48> col:8 ntsbindgir_macro_0 'int'
`-ConstantExpr 0x1 <col:29, col:48> 'int'
  |-value: Int 64
  `-CStyleCastExpr 0x1 <col:29, col:48> 'int' <IntegralCast>
    `-ParenExpr 0x1 <col:34, col:48> 'GType':'unsigned long'
";
        let facts = super::parse(
            dump,
            &super::Asked {
                structs: &[],
                enums: &[],
                slots: &[],
                sized: &[],
                functions: &[],
                macros: &["G_TYPE_STRING", "G_TYPE_GTYPE"],
            },
        );
        assert_eq!(facts.macros.get("G_TYPE_STRING"), Some(&64));
        assert!(
            !facts.macros.contains_key("G_TYPE_GTYPE"),
            "a macro defined as a call was valued"
        );
    }
}
