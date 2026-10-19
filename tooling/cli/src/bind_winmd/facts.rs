//! What the headers say, asked of clang: the exact C type of every function,
//! struct field and typedef the metadata names.
//!
//! Each question is a declaration whose name starts with a prefix no header
//! uses (`__typeof__(F) ntswinmd_fn_F;`), and `-ast-dump-filter` prints only
//! those, so a probe of all of `windows.h` is a fraction of a second. clang
//! desugars one typedef per answer, so the names still left in the answers are
//! asked about in the next round, until none are.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use anyhow::{Context, Result};

use super::ctype::{self, CType};

const PREFIX: &str = "ntswinmd_";

/// Header layout beside two C declarations of the same fields. Let clang
/// lay them out: duplicating a target ABI's layout rules here would turn the
/// witness into a second layout engine. Matches include every field offset.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RecordLayout {
    pub(crate) size: u32,
    pub(crate) align: u32,
    pub(crate) natural_size: u32,
    pub(crate) natural_align: u32,
    pub(crate) packed_size: u32,
    pub(crate) packed_align: u32,
    pub(crate) natural_matches: bool,
    pub(crate) packed_matches: bool,
}

pub(crate) struct RecordQuestion<'a> {
    pub(crate) name: &'a str,
    pub(crate) union: bool,
    pub(crate) fields: Vec<&'a str>,
}

/// The C types the headers gave, resolved.
#[derive(Debug, Default)]
pub(crate) struct Facts {
    pub(crate) records: BTreeMap<String, RecordLayout>,
    /// Function name to its C function type.
    pub(crate) functions: BTreeMap<String, CType>,
    /// `(struct, field)` to the field's C type.
    pub(crate) fields: BTreeMap<(String, String), CType>,
    /// A C vtable field's byte offset divided by the pointer size. Inherited
    /// fields are present in the C declaration, so these are absolute slots.
    pub(crate) field_slots: BTreeMap<(String, String), u32>,
    /// Typedef name to what it resolves to.
    pub(crate) typedefs: BTreeMap<String, CType>,
    /// Enum tag to the one integer spelling clang says it is compatible
    /// with, asked with the checker's own predicate. A tag with zero or
    /// several answers has no entry and stays refused.
    pub(crate) enums: BTreeMap<String, String>,
    /// Why a question had no answer, by the name asked about.
    pub(crate) unanswered: BTreeMap<String, String>,
}

/// What to ask.
#[derive(Default)]
pub(crate) struct Questions<'a> {
    pub(crate) records: Vec<RecordQuestion<'a>>,
    pub(crate) functions: Vec<&'a str>,
    pub(crate) fields: Vec<(&'a str, &'a str)>,
    /// Function-pointer fields whose vtable slot the caller also needs.
    /// These fields must also occur in `fields`.
    pub(crate) field_slots: Vec<(&'a str, &'a str)>,
    pub(crate) typedefs: Vec<&'a str>,
}

/// The include lines for one probe: `<windows.h>` outright (its absence
/// is an error worth hearing), and each further header behind
/// `__has_include`, trying the name the documentation gives and then
/// its unsplit form — which of them this toolchain carries is clang's
/// search to answer, never a path laid out here.
pub(crate) fn include_lines(headers: &[Vec<String>]) -> Vec<String> {
    // Ask for the C vtable declarations even when a header offers C++ COM
    // syntax too. The backend calls through these same function pointers.
    let mut lines = vec!["#define CINTERFACE".to_owned()];
    for group in headers {
        if group.len() == 1 && group[0] == "windows.h" {
            lines.push("#include <windows.h>".to_owned());
            continue;
        }
        for (index, header) in group.iter().enumerate() {
            let if_ = if index == 0 { "#if" } else { "#elif" };
            lines.push(format!("{if_} __has_include(<{header}>)"));
            lines.push(format!("#include <{header}>"));
        }
        lines.push("#endif".to_owned());
    }
    lines
}

struct Answer {
    name: String,
    qual: String,
    desugared: Option<String>,
    value: Option<u32>,
}

/// clang nests an evaluated enum initializer under implicit casts. Read only
/// its `ConstantExpr`, never an unevaluated literal inside the expression.
fn constant_value(node: &serde_json::Value) -> Option<u32> {
    if node.get("kind").and_then(serde_json::Value::as_str) == Some("ConstantExpr") {
        return node.get("value")?.as_str()?.parse().ok();
    }
    node.get("inner")?
        .as_array()?
        .iter()
        .find_map(constant_value)
}

/// One clang run over `headers` and `declarations`, answering with each probe's
/// type spelling and, for a slot question, its evaluated integer value.
fn ask(headers: &[Vec<String>], clang_args: &[String], declarations: &str) -> Result<Vec<Answer>> {
    let dir = std::env::temp_dir().join(format!(
        "nts-bind-winmd-{}-{}",
        std::process::id(),
        CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let probe = dir.join("probe.c");
    let mut text = String::new();
    for line in include_lines(headers) {
        let _ = writeln!(text, "{line}");
    }
    text.push_str(declarations);
    std::fs::write(&probe, &text).with_context(|| format!("writing {}", probe.display()))?;
    // Probes that name nothing fail to compile; the AST still holds every one
    // that did, which is the answer. `-ferror-limit=0` lets all of them try.
    let output = std::process::Command::new("clang")
        .args(clang_args)
        .args([
            "-fsyntax-only",
            "-ferror-limit=0",
            "-w",
            "-Xclang",
            "-ast-dump=json",
            "-Xclang",
        ])
        .arg(format!("-ast-dump-filter={PREFIX}"))
        .arg(&probe)
        .output()
        .context("running clang to read the Windows headers")?;
    let _ = std::fs::remove_dir_all(&dir);
    let text = String::from_utf8_lossy(&output.stdout);
    let mut answers = Vec::new();
    let mut decoder = serde_json::Deserializer::from_str(&text).into_iter::<serde_json::Value>();
    while let Some(Ok(node)) = decoder.next() {
        // clang can retain a declaration with a recovery type after a missing
        // member error. That is not an answer from the header.
        if node.get("isInvalid").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        let Some(name) = node.get("name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(ty) = node.get("type") else { continue };
        let Some(qual) = ty.get("qualType").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let desugared = ty
            .get("desugaredQualType")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        answers.push(Answer {
            name: name.to_owned(),
            qual: qual.to_owned(),
            desugared,
            value: constant_value(&node),
        });
    }
    Ok(answers)
}

static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Type and layout declarations share one filtered C probe.
fn declarations(questions: &Questions) -> String {
    let mut probes = String::new();
    for name in &questions.functions {
        let _ = writeln!(probes, "__typeof__({name}) {PREFIX}fn_{name};");
    }
    for (at, (record, field)) in questions.fields.iter().enumerate() {
        let _ = writeln!(
            probes,
            "__typeof__((({record} *)0)->{field}) {PREFIX}field_{at};"
        );
    }
    for (at, (record, field)) in questions.field_slots.iter().enumerate() {
        // Supported Windows targets have pointer-sized vtable entries. Refuse
        // an incompatible field or an unaligned offset rather than rounding.
        let offset = format!("__builtin_offsetof({record}, {field})");
        let size = format!("sizeof((({record} *)0)->{field})");
        let _ = writeln!(
            probes,
            "enum {{ {PREFIX}slot_{at} = ({size} == sizeof(void *) && \
             {offset} % sizeof(void *) == 0) ? {offset} / sizeof(void *) : -1 }};"
        );
    }
    // Reset any enclosing pragma while declaring comparison shapes; nested
    // field types keep their own header layouts (including packing).
    probes.push_str("#pragma pack(push)\n#pragma pack()\n");
    for (at, record) in questions.records.iter().enumerate() {
        let keyword = if record.union { "union" } else { "struct" };
        let name = record.name;
        for packing in ["natural", "packed"] {
            let attr = if packing == "packed" {
                "__attribute__((packed)) "
            } else {
                ""
            };
            let shape = format!("{PREFIX}shape_{at}_{packing}");
            let _ = writeln!(probes, "typedef {keyword} {attr}{{");
            for field in &record.fields {
                let _ = writeln!(probes, "__typeof__((({name} *)0)->{field}) {field};");
            }
            let _ = writeln!(probes, "}} {shape};");
            // A record's sizeof is valid even with a flexible tail. Each
            // field must itself be complete and addressable: neither a
            // flexible array nor a bitfield can become an ordinary Struct.
            let mut offsets = String::new();
            for field in &record.fields {
                let _ = write!(
                    offsets,
                    " && sizeof((({name} *)0)->{field}) == sizeof((({shape} *)0)->{field}) && __builtin_offsetof({name}, {field}) == __builtin_offsetof({shape}, {field})"
                );
            }
            let _ = writeln!(
                probes,
                "enum {{ {PREFIX}layout_{at}_{packing}_size = sizeof({shape}), {PREFIX}layout_{at}_{packing}_align = _Alignof({shape}), {PREFIX}layout_{at}_{packing}_matches = sizeof({name}) == sizeof({shape}) && _Alignof({name}) == _Alignof({shape}){offsets} }};"
            );
        }
        let _ = writeln!(
            probes,
            "enum {{ {PREFIX}layout_{at}_size = sizeof({name}), {PREFIX}layout_{at}_align = _Alignof({name}) }};"
        );
    }
    probes.push_str("#pragma pack(pop)\n");
    probes
}

/// Ask, then keep asking about the typedef names the answers mention.
pub(crate) fn resolve(
    headers: &[Vec<String>],
    clang_args: &[String],
    questions: &Questions,
) -> Result<Facts> {
    let mut spellings: BTreeMap<String, String> = BTreeMap::new();
    let mut function_text: BTreeMap<String, String> = BTreeMap::new();
    let mut field_text: BTreeMap<usize, String> = BTreeMap::new();
    let mut slots: BTreeMap<usize, u32> = BTreeMap::new();
    let mut layouts = BTreeMap::new();
    // `__typeof__(F)` is what the probe says; the type it stands for is one
    // desugaring away.
    for answer in ask(headers, clang_args, &declarations(questions))? {
        if let Some(key) = answer.name.strip_prefix(&format!("{PREFIX}layout_"))
            && let Some(value) = answer.value
        {
            layouts.insert(key.to_owned(), value);
            continue;
        }
        let spelled = answer.desugared.unwrap_or(answer.qual);
        if let Some(function) = answer.name.strip_prefix(&format!("{PREFIX}fn_")) {
            function_text.insert(function.to_owned(), spelled);
        } else if let Some(at) = answer
            .name
            .strip_prefix(&format!("{PREFIX}field_"))
            .and_then(|at| at.parse().ok())
        {
            field_text.insert(at, spelled);
        } else if let Some(at) = answer
            .name
            .strip_prefix(&format!("{PREFIX}slot_"))
            .and_then(|at| at.parse().ok())
            && let Some(value) = answer.value
        {
            slots.insert(at, value);
        }
    }
    // The typedef chain, one round per level.
    let mut pending: BTreeSet<String> = questions
        .typedefs
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    for text in function_text.values().chain(field_text.values()) {
        pending.extend(ctype::typedef_names(text));
    }
    let mut asked: BTreeSet<String> = BTreeSet::new();
    for _round in 0..16 {
        pending.retain(|name| !asked.contains(name));
        if pending.is_empty() {
            break;
        }
        let mut probes = String::new();
        for name in &pending {
            // An alias can name void or an incomplete record; an object
            // declaration of either is invalid even when the type is real.
            let _ = writeln!(probes, "typedef {name} {PREFIX}td_{name};");
        }
        asked.extend(pending.iter().cloned());
        let mut next = BTreeSet::new();
        for answer in ask(headers, clang_args, &probes)? {
            let Some(name) = answer.name.strip_prefix(&format!("{PREFIX}td_")) else {
                continue;
            };
            let resolved = answer.desugared.unwrap_or(answer.qual);
            next.extend(ctype::typedef_names(&resolved));
            spellings.insert(name.to_owned(), resolved);
        }
        pending = next;
    }
    let mut facts = Facts::default();
    resolve_records(&mut facts, questions, &layouts);
    for (name, text) in function_text {
        match ctype::parse(&text, &spellings) {
            Ok(ty) => {
                facts.functions.insert(name, ty);
            }
            Err(why) => {
                facts.unanswered.insert(name, why.to_string());
            }
        }
    }
    resolve_fields(&mut facts, questions, field_text, &slots, &spellings);
    for name in &questions.typedefs {
        if let Some(text) = spellings.get(*name)
            && let Ok(ty) = ctype::parse(text, &spellings)
        {
            facts.typedefs.insert((*name).to_owned(), ty);
        }
    }
    resolve_enums(&mut facts, headers, clang_args)?;
    Ok(facts)
}

/// The integer spellings an enum's compatible type can be, as `ctype`
/// canonicalises them. Char-sized answers are real answers (a packed enum),
/// not a reason to guess a wider one.
const ENUM_INTEGERS: [&str; 11] = [
    "char",
    "signed char",
    "unsigned char",
    "short",
    "unsigned short",
    "int",
    "unsigned int",
    "long",
    "unsigned long",
    "long long",
    "unsigned long long",
];

fn enum_tags(ty: &CType, tags: &mut BTreeSet<String>) {
    match ty {
        CType::Enum(tag) => {
            tags.insert(tag.clone());
        }
        CType::Pointer { to, .. } | CType::Array(to, _) => enum_tags(to, tags),
        CType::Function {
            result, parameters, ..
        } => {
            enum_tags(result, tags);
            for parameter in parameters {
                enum_tags(parameter, tags);
            }
        }
        CType::Void | CType::Scalar(_) | CType::Record { .. } => {}
    }
}

/// Which integer each resolved enum type crosses as, in one more ask: the
/// same `__builtin_types_compatible_p` the binding's self-check will hold
/// every prototype to, so an answer here is a witness there.
///
/// Clang spells two header shapes the same way in a resolved type: a real
/// `enum TAG`, and a typedef of an anonymous enum, whose name it borrows
/// (`typedef enum { ... } ASSOCSTR;` reads back as `enum ASSOCSTR`).
/// Writing `enum ASSOCSTR` in a probe would name a fresh incomplete tag,
/// so both spellings are asked. The tag spelling is the header's own
/// name for the type and wins; the bare name is only an answer when the
/// tag spelling has none. An incomplete tag is compatible with nothing,
/// so the fallback cannot be taken in by the probe's own forward tag.
fn resolve_enums(facts: &mut Facts, headers: &[Vec<String>], clang_args: &[String]) -> Result<()> {
    let mut tags = BTreeSet::new();
    for ty in facts
        .functions
        .values()
        .chain(facts.fields.values())
        .chain(facts.typedefs.values())
    {
        enum_tags(ty, &mut tags);
    }
    if tags.is_empty() {
        return Ok(());
    }
    let tags: Vec<String> = tags.into_iter().collect();
    let mut probes = String::new();
    for (at, tag) in tags.iter().enumerate() {
        for (candidate, spelling) in ENUM_INTEGERS.iter().enumerate() {
            let _ = writeln!(
                probes,
                "enum {{ {PREFIX}enum_{at}_{candidate} = \
                 __builtin_types_compatible_p(enum {tag}, {spelling}) }};"
            );
            let _ = writeln!(
                probes,
                "enum {{ {PREFIX}enumtype_{at}_{candidate} = \
                 __builtin_types_compatible_p({tag}, {spelling}) }};"
            );
        }
    }
    // Compatible spellings by tag, kept apart by which name was asked:
    // `enum TAG` first, the bare typedef name second.
    let mut by_tag: BTreeMap<usize, Vec<&str>> = BTreeMap::new();
    let mut by_name: BTreeMap<usize, Vec<&str>> = BTreeMap::new();
    for answer in ask(headers, clang_args, &probes)? {
        let (key, answers) =
            if let Some(key) = answer.name.strip_prefix(&format!("{PREFIX}enumtype_")) {
                (key, &mut by_name)
            } else if let Some(key) = answer.name.strip_prefix(&format!("{PREFIX}enum_")) {
                (key, &mut by_tag)
            } else {
                continue;
            };
        let (Some(at), Some(candidate)) = (
            key.split('_')
                .next()
                .and_then(|at| at.parse::<usize>().ok()),
            key.split('_')
                .nth(1)
                .and_then(|at| at.parse::<usize>().ok()),
        ) else {
            continue;
        };
        if answer.value == Some(1)
            && let Some(spelling) = ENUM_INTEGERS.get(candidate)
        {
            answers.entry(at).or_default().push(spelling);
        }
    }
    for (at, tag) in tags.iter().enumerate() {
        let answers = match (by_tag.get(&at), by_name.get(&at)) {
            (Some(answers), _) if !answers.is_empty() => answers,
            (_, Some(answers)) => answers,
            _ => continue,
        };
        if let [spelling] = answers.as_slice() {
            facts.enums.insert(tag.clone(), (*spelling).to_owned());
        }
    }
    Ok(())
}

fn resolve_records(facts: &mut Facts, questions: &Questions, layouts: &BTreeMap<String, u32>) {
    for (at, record) in questions.records.iter().enumerate() {
        let value = |key: &str| layouts.get(&format!("{at}_{key}")).copied();
        let layout = || {
            Some(RecordLayout {
                size: value("size")?,
                align: value("align")?,
                natural_size: value("natural_size")?,
                natural_align: value("natural_align")?,
                packed_size: value("packed_size")?,
                packed_align: value("packed_align")?,
                natural_matches: value("natural_matches")? == 1,
                packed_matches: value("packed_matches")? == 1,
            })
        };
        if let Some(layout) = layout() {
            facts.records.insert(record.name.to_owned(), layout);
        } else {
            facts.unanswered.insert(
                record.name.to_owned(),
                "the headers did not answer the record's complete layout".into(),
            );
        }
    }
}

/// Ordinary fields and C vtable entries share the same C type resolution.
fn resolve_fields(
    facts: &mut Facts,
    questions: &Questions,
    field_text: BTreeMap<usize, String>,
    slots: &BTreeMap<usize, u32>,
    spellings: &BTreeMap<String, String>,
) {
    for (at, text) in field_text {
        let (record, field) = questions.fields[at];
        match ctype::parse(&text, spellings) {
            Ok(ty) => {
                facts
                    .fields
                    .insert((record.to_owned(), field.to_owned()), ty);
            }
            Err(why) => {
                facts
                    .unanswered
                    .insert(format!("{record}.{field}"), why.to_string());
            }
        }
    }
    for (at, &(record, field)) in questions.field_slots.iter().enumerate() {
        let key = (record.to_owned(), field.to_owned());
        let function_pointer = matches!(
            facts.fields.get(&key),
            Some(CType::Pointer { to, .. }) if matches!(**to, CType::Function { .. })
        );
        if let Some(&slot) = slots.get(&at)
            && function_pointer
        {
            facts.field_slots.insert(key, slot);
        } else {
            facts
                .unanswered
                .entry(format!("{record}.{field}"))
                .or_insert_with(|| {
                    "the header has no pointer-sized vtable method at an aligned slot".to_owned()
                });
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::{CType, Facts, Questions, resolve};

    // Deliberately self-contained: no installed Windows SDK supplies the
    // inheritance, typedefs or method signatures this test is asserting.
    const HEADER: &str = r"
        #ifndef CINTERFACE
        #error the probe must request C interface declarations
        #endif
        #define STDMETHODCALLTYPE __stdcall
        typedef long HRESULT;
        typedef unsigned long ULONG;
        typedef struct _GUID { unsigned long value; } GUID;
        typedef const GUID *const REFIID;
        typedef struct IUnknown IUnknown;
        typedef struct IBase IBase;
        typedef struct IDerived IDerived;
        #define UNKNOWN_METHODS(T) \
            HRESULT (STDMETHODCALLTYPE *QueryInterface)(T *, REFIID, void **); \
            ULONG (STDMETHODCALLTYPE *AddRef)(T *); \
            ULONG (STDMETHODCALLTYPE *Release)(T *);
        #define BASE_METHODS(T) UNKNOWN_METHODS(T) \
            ULONG (STDMETHODCALLTYPE *GetFlags)(T *);
        typedef struct IUnknownVtbl { UNKNOWN_METHODS(IUnknown) } IUnknownVtbl;
        typedef struct IBaseVtbl { BASE_METHODS(IBase) } IBaseVtbl;
        typedef struct IDerivedVtbl {
            BASE_METHODS(IDerived)
            HRESULT (STDMETHODCALLTYPE *SetValue)(IDerived *, REFIID, void **);
        } IDerivedVtbl;
    ";

    fn header_facts(header: &str, fields: Vec<(&str, &str)>, arch: &str) -> Facts {
        let dir = std::env::temp_dir().join(format!(
            "nts-com-facts-test-{}-{}",
            std::process::id(),
            super::CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("com.h"), header).unwrap();
        let result = resolve(
            &[vec!["com.h".to_owned()]],
            &[
                format!("--target={arch}-w64-windows-gnu"),
                "-std=c11".to_owned(),
                format!("-I{}", dir.display()),
            ],
            &Questions {
                field_slots: fields.clone(),
                fields,
                ..Questions::default()
            },
        );
        std::fs::remove_dir_all(&dir).unwrap();
        result.unwrap()
    }

    fn function(facts: &Facts, record: &str, method: &str) -> CType {
        let ty = &facts.fields[&(record.to_owned(), method.to_owned())];
        let CType::Pointer { to, .. } = ty else {
            panic!("{record}.{method} is not a function pointer: {ty:?}")
        };
        assert!(matches!(**to, CType::Function { .. }), "{to:?}");
        *to.clone()
    }

    fn parsed(text: &str) -> CType {
        super::ctype::parse(text, &std::collections::BTreeMap::new()).unwrap()
    }

    #[test]
    fn c_vtable_facts_keep_inherited_slots_and_exact_method_types() {
        let fields = vec![
            ("IUnknownVtbl", "QueryInterface"),
            ("IUnknownVtbl", "AddRef"),
            ("IUnknownVtbl", "Release"),
            ("IBaseVtbl", "GetFlags"),
            ("IDerivedVtbl", "QueryInterface"),
            ("IDerivedVtbl", "GetFlags"),
            ("IDerivedVtbl", "SetValue"),
        ];
        for arch in ["x86_64", "aarch64"] {
            let facts = header_facts(HEADER, fields.clone(), arch);
            assert!(facts.unanswered.is_empty(), "{:?}", facts.unanswered);
            for (&(record, method), slot) in fields.iter().zip([0, 1, 2, 3, 0, 3, 4]) {
                assert_eq!(
                    facts.field_slots[&(record.to_owned(), method.to_owned())],
                    slot
                );
            }
            // HRESULT remains Windows `long`, ULONG remains `unsigned long`,
            // REFIID is a const GUID pointer, and an out void** keeps both levels.
            assert_eq!(
                function(&facts, "IUnknownVtbl", "QueryInterface"),
                parsed("long (struct IUnknown *, const struct _GUID *, void **)")
            );
            assert_eq!(
                function(&facts, "IDerivedVtbl", "SetValue"),
                parsed("long (struct IDerived *, const struct _GUID *, void **)")
            );
            assert_eq!(
                function(&facts, "IDerivedVtbl", "QueryInterface"),
                parsed("long (struct IDerived *, const struct _GUID *, void **)")
            );
            assert_eq!(
                function(&facts, "IBaseVtbl", "GetFlags"),
                parsed("unsigned long (struct IBase *)")
            );
        }
    }

    fn function_facts(header: &str, functions: Vec<&str>, arch: &str) -> Facts {
        let dir = std::env::temp_dir().join(format!(
            "nts-enum-facts-test-{}-{}",
            std::process::id(),
            super::CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("enums.h"), header).unwrap();
        let result = resolve(
            &[vec!["enums.h".to_owned()]],
            &[
                format!("--target={arch}-w64-windows-gnu"),
                "-std=c11".to_owned(),
                format!("-I{}", dir.display()),
            ],
            &Questions {
                functions,
                ..Questions::default()
            },
        );
        std::fs::remove_dir_all(&dir).unwrap();
        result.unwrap()
    }

    #[test]
    fn an_enum_tags_compatible_integer_comes_from_the_header() {
        // One member below zero keeps the first signed; one member past
        // INT_MAX makes the second unsigned. A binder that guessed `int`
        // for both would pass the first assertion and fail the second.
        // The third is a typedef of an anonymous enum: clang reads the
        // parameter back as `enum Anon`, a tag no header declares, so the
        // answer has to come from asking about the typedef name itself.
        let header = "typedef enum _Signed { SIGNED_A = -1, SIGNED_B = 2 } Signed;\n\
            typedef enum _Unsigned { UNSIGNED_A = 0, UNSIGNED_B = 2147483648u } Unsigned;\n\
            typedef enum { ANON_A = 0, ANON_B = 1 } Anon;\n\
            void UseSigned(Signed value);\n\
            void UseUnsigned(Unsigned value);\n\
            void UseAnon(Anon value);";
        for arch in ["x86_64", "aarch64"] {
            let facts = function_facts(header, vec!["UseSigned", "UseUnsigned", "UseAnon"], arch);
            assert_eq!(facts.enums["_Signed"], "int", "{arch}");
            assert_eq!(facts.enums["_Unsigned"], "unsigned int", "{arch}");
            let CType::Function { parameters, .. } = &facts.functions["UseAnon"] else {
                panic!("UseAnon is not a function: {:?}", facts.functions);
            };
            assert_eq!(parameters, &[CType::Enum("Anon".into())], "{arch}");
            assert_eq!(facts.enums["Anon"], "unsigned int", "{arch}");
        }
    }

    #[test]
    fn a_missing_vtable_method_has_a_named_unanswered_fact() {
        // Only the question's member name changes; the valid method is the
        // control against accepting clang's recovery type for a missing one.
        for method in ["SetValue", "Missing"] {
            let facts = header_facts(HEADER, vec![("IDerivedVtbl", method)], "x86_64");
            let key = ("IDerivedVtbl".to_owned(), method.to_owned());
            if method == "SetValue" {
                assert!(facts.fields.contains_key(&key));
                assert_eq!(facts.field_slots[&key], 4);
                assert!(facts.unanswered.is_empty(), "{:?}", facts.unanswered);
            } else {
                assert!(!facts.fields.contains_key(&key));
                assert!(!facts.field_slots.contains_key(&key));
                assert!(facts.unanswered.contains_key("IDerivedVtbl.Missing"));
            }
        }
    }

    #[test]
    fn void_and_incomplete_typedefs_resolve_without_invalid_objects() {
        let header = "typedef void ERASED;\n\
            typedef struct Incomplete Incomplete;\n\
            typedef struct ITestVtbl { void (*Call)(ERASED *, Incomplete *); } ITestVtbl;";
        let facts = header_facts(header, vec![("ITestVtbl", "Call")], "x86_64");
        assert!(facts.unanswered.is_empty(), "{:?}", facts.unanswered);
        assert_eq!(
            facts.field_slots[&("ITestVtbl".to_owned(), "Call".to_owned())],
            0
        );
        assert_eq!(
            function(&facts, "ITestVtbl", "Call"),
            parsed("void (void *, struct Incomplete *)")
        );
    }

    #[test]
    fn a_vtable_slot_requires_a_pointer_sized_function_pointer() {
        let header = format!(
            "{HEADER}\n\
            typedef struct InvalidVtbl {{ char Byte; void *Data; }} InvalidVtbl;\n\
            typedef struct __attribute__((packed)) MisalignedVtbl {{ char Pad; void (*Call)(void); }} MisalignedVtbl;"
        );
        let facts = header_facts(
            &header,
            vec![
                ("InvalidVtbl", "Byte"),
                ("InvalidVtbl", "Data"),
                ("MisalignedVtbl", "Call"),
            ],
            "x86_64",
        );
        assert!(facts.field_slots.is_empty(), "{:?}", facts.field_slots);
        assert!(facts.unanswered.contains_key("InvalidVtbl.Byte"));
        assert!(facts.unanswered.contains_key("InvalidVtbl.Data"));
        assert!(facts.unanswered.contains_key("MisalignedVtbl.Call"));
    }
}
