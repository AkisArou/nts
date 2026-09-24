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

/// The C types the headers gave, resolved.
#[derive(Debug, Default)]
pub(crate) struct Facts {
    /// Function name to its C function type.
    pub(crate) functions: BTreeMap<String, CType>,
    /// `(struct, field)` to the field's C type.
    pub(crate) fields: BTreeMap<(String, String), CType>,
    /// Typedef name to what it resolves to.
    pub(crate) typedefs: BTreeMap<String, CType>,
    /// Why a question had no answer, by the name asked about.
    pub(crate) unanswered: BTreeMap<String, String>,
}

/// What to ask.
pub(crate) struct Questions<'a> {
    pub(crate) functions: Vec<&'a str>,
    pub(crate) fields: Vec<(&'a str, &'a str)>,
    pub(crate) typedefs: Vec<&'a str>,
}

/// One clang run over `headers` and `declarations`, answering with each probe's
/// `(name, qualType, desugaredQualType)`.
fn ask(headers: &[String], clang_args: &[String], declarations: &str) -> Result<Vec<(String, String, Option<String>)>> {
    let dir = std::env::temp_dir().join(format!(
        "nts-bind-winmd-{}-{}",
        std::process::id(),
        CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let probe = dir.join("probe.c");
    let mut text = String::new();
    for header in headers {
        let _ = writeln!(text, "#include <{header}>");
    }
    text.push_str(declarations);
    std::fs::write(&probe, &text).with_context(|| format!("writing {}", probe.display()))?;
    // Probes that name nothing fail to compile; the AST still holds every one
    // that did, which is the answer. `-ferror-limit=0` lets all of them try.
    let output = std::process::Command::new("clang")
        .args(clang_args)
        .args(["-fsyntax-only", "-ferror-limit=0", "-w", "-Xclang", "-ast-dump=json", "-Xclang"])
        .arg(format!("-ast-dump-filter={PREFIX}"))
        .arg(&probe)
        .output()
        .context("running clang to read the Windows headers")?;
    let _ = std::fs::remove_dir_all(&dir);
    let text = String::from_utf8_lossy(&output.stdout);
    let mut answers = Vec::new();
    let mut decoder = serde_json::Deserializer::from_str(&text).into_iter::<serde_json::Value>();
    while let Some(Ok(node)) = decoder.next() {
        let Some(name) = node.get("name").and_then(serde_json::Value::as_str) else { continue };
        let Some(ty) = node.get("type") else { continue };
        let Some(qual) = ty.get("qualType").and_then(serde_json::Value::as_str) else { continue };
        let desugared = ty.get("desugaredQualType").and_then(serde_json::Value::as_str).map(str::to_owned);
        answers.push((name.to_owned(), qual.to_owned(), desugared));
    }
    Ok(answers)
}

static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Ask, then keep asking about the typedef names the answers mention.
pub(crate) fn resolve(headers: &[String], clang_args: &[String], questions: &Questions) -> Result<Facts> {
    let mut probes = String::new();
    for name in &questions.functions {
        let _ = writeln!(probes, "__typeof__({name}) {PREFIX}fn_{name};");
    }
    for (at, (record, field)) in questions.fields.iter().enumerate() {
        let _ = writeln!(probes, "__typeof__((({record} *)0)->{field}) {PREFIX}field_{at};");
    }
    let mut spellings: BTreeMap<String, String> = BTreeMap::new();
    let mut function_text: BTreeMap<String, String> = BTreeMap::new();
    let mut field_text: BTreeMap<usize, String> = BTreeMap::new();
    // `__typeof__(F)` is what the probe says; the type it stands for is one
    // desugaring away.
    for (name, qual, desugared) in ask(headers, clang_args, &probes)? {
        let spelled = desugared.unwrap_or(qual);
        if let Some(function) = name.strip_prefix(&format!("{PREFIX}fn_")) {
            function_text.insert(function.to_owned(), spelled);
        } else if let Some(at) = name.strip_prefix(&format!("{PREFIX}field_")).and_then(|at| at.parse().ok()) {
            field_text.insert(at, spelled);
        }
    }
    // The typedef chain, one round per level.
    let mut pending: BTreeSet<String> = questions.typedefs.iter().map(|name| (*name).to_owned()).collect();
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
            let _ = writeln!(probes, "{name} {PREFIX}td_{name};");
        }
        asked.extend(pending.iter().cloned());
        let mut next = BTreeSet::new();
        for (probe, qual, desugared) in ask(headers, clang_args, &probes)? {
            let Some(name) = probe.strip_prefix(&format!("{PREFIX}td_")) else { continue };
            let resolved = desugared.unwrap_or(qual);
            next.extend(ctype::typedef_names(&resolved));
            spellings.insert(name.to_owned(), resolved);
        }
        pending = next;
    }
    let mut facts = Facts::default();
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
    for (at, text) in field_text {
        let (record, field) = questions.fields[at];
        match ctype::parse(&text, &spellings) {
            Ok(ty) => {
                facts.fields.insert((record.to_owned(), field.to_owned()), ty);
            }
            Err(why) => {
                facts.unanswered.insert(format!("{record}.{field}"), why.to_string());
            }
        }
    }
    for name in &questions.typedefs {
        if let Some(text) = spellings.get(*name)
            && let Ok(ty) = ctype::parse(text, &spellings)
        {
            facts.typedefs.insert((*name).to_owned(), ty);
        }
    }
    Ok(facts)
}
