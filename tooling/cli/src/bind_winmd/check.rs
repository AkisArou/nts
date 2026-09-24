//! Every declaration a binding keeps has compiled against the headers.
//!
//! The C spelling each declaration carries is what nts will emit for it, so
//! the question is the build witness's own, asked of every declaration rather
//! than only the ones a program happens to call: `__builtin_types_compatible_p`
//! between the header's declaration and ours, one assertion per line, one
//! clang run per namespace. Whatever clang rejects is dropped, with its reason,
//! and so is everything that named it.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};

use super::map::Binding;
use super::read::Name;

enum Line {
    Function(String),
    Field(String),
    Constant(String),
}

/// The check file, and which declaration each assertion line is about.
#[derive(Default)]
struct Probe {
    text: String,
    lines: BTreeMap<usize, Line>,
    count: usize,
}

impl Probe {
    fn line(&mut self, text: &str, about: Option<Line>) {
        self.count += 1;
        self.text.push_str(text);
        self.text.push('\n');
        if let Some(about) = about {
            self.lines.insert(self.count, about);
        }
    }
}

pub(crate) fn against_headers(bindings: &mut [Binding], headers: &[String], clang_args: &[String]) -> Result<()> {
    let mut dropped: BTreeSet<Name> = BTreeSet::new();
    for binding in bindings.iter_mut() {
        let probe = probe(binding, headers);
        let stderr = compile(&binding.namespace, &probe.text, clang_args)?;
        drop_rejected(binding, &stderr, &probe.lines, &mut dropped)?;
    }
    cascade(bindings, dropped);
    Ok(())
}

/// One assertion per declaration, after what a generated program includes.
fn probe(binding: &Binding, headers: &[String]) -> Probe {
    let mut probe = Probe::default();
    // What a generated program always has, through the runtime: the
    // spellings nts emits (`uint16_t`, `bool`) need these, and `windows.h`
    // includes neither.
    probe.line("#include <stdint.h>", None);
    probe.line("#include <stdbool.h>", None);
    for header in headers {
        probe.line(&format!("#include <{header}>"), None);
    }
    for function in &binding.functions {
        probe.line(
            &format!(
                "_Static_assert(__builtin_types_compatible_p(__typeof__(&{}), {}), \"{}\");",
                function.name, function.c_type, function.name
            ),
            Some(Line::Function(function.name.clone())),
        );
    }
    for (record, record_c, field, field_c) in &binding.field_checks {
        let assertion = match field_c.strip_suffix(']').and_then(|s| s.rsplit_once('[')) {
            Some((element, count)) => format!(
                "__builtin_types_compatible_p(__typeof__((({record_c} *)0)->{field}[0]), {element}) && \
                 sizeof((({record_c} *)0)->{field}) / sizeof((({record_c} *)0)->{field}[0]) == {count}"
            ),
            None => format!("__builtin_types_compatible_p(__typeof__((({record_c} *)0)->{field}), {field_c})"),
        };
        probe.line(&format!("_Static_assert({assertion}, \"{record}.{field}\");"), Some(Line::Field(record.clone())));
    }
    for constant in &binding.constants {
        // Only a macro can be compared here: an enumerator, or a value the
        // headers do not define, is Microsoft's word, which is the source.
        probe.line(&format!("#ifdef {}", constant.name), None);
        probe.line(
            &format!("_Static_assert((long long)({0}) == (long long)({1}), \"{0}\");", constant.name, constant.value),
            Some(Line::Constant(constant.name.clone())),
        );
        probe.line("#endif", None);
    }
    probe
}

/// clang's diagnostics for `text`, compiled once with every error reported.
///
/// `NTS_BIND_WINMD_KEEP=1` keeps the probe and clang's answer beside it, which
/// is where a refusal's reason is read in full.
fn compile(namespace: &str, text: &str, clang_args: &[String]) -> Result<String> {
    let dir = std::env::temp_dir().join(format!("nts-bind-winmd-check-{}", std::process::id()));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let probe = dir.join(format!("{}.c", namespace.replace('.', "_")));
    std::fs::write(&probe, text).with_context(|| format!("writing {}", probe.display()))?;
    let output = std::process::Command::new("clang")
        .args(clang_args)
        .args(["-std=c11", "-fsyntax-only", "-ferror-limit=0", "-w"])
        .arg(&probe)
        .output()
        .context("running clang on the binding's self-check")?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if std::env::var_os("NTS_BIND_WINMD_KEEP").is_some() {
        std::fs::write(probe.with_extension("stderr"), stderr.as_bytes()).ok();
        eprintln!("kept {}", probe.display());
    } else {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(stderr)
}

/// Remove from `binding` what an error line names. An error on no assertion
/// line means the headers themselves did not compile, and says so.
fn drop_rejected(binding: &mut Binding, stderr: &str, lines: &BTreeMap<usize, Line>, dropped: &mut BTreeSet<Name>) -> Result<()> {
    let file = format!("{}.c", binding.namespace.replace('.', "_"));
    let mut functions = BTreeSet::new();
    let mut records = BTreeSet::new();
    let mut constants = BTreeSet::new();
    for error in stderr.lines().filter(|line| line.contains(": error:") && line.contains(&file)) {
        let Some(number) = error.split(':').nth(1).and_then(|n| n.parse::<usize>().ok()) else { continue };
        match lines.get(&number) {
            Some(Line::Function(name)) => functions.insert(name.clone()),
            Some(Line::Field(record)) => records.insert(record.clone()),
            Some(Line::Constant(name)) => constants.insert(name.clone()),
            None => anyhow::bail!("the Windows headers did not compile for the check: {error}"),
        };
    }
    for record in &records {
        dropped.insert((binding.namespace.clone(), record.clone()));
        binding.refused.push((record.clone(), "a field's type disagrees with the header".into()));
    }
    binding.types.retain(|decl| !records.contains(decl.name()));
    let mut refused = Vec::new();
    binding.functions.retain(|function| {
        let keep = !functions.contains(&function.name);
        if !keep {
            refused.push((function.name.clone(), "its type disagrees with the header".into()));
        }
        keep
    });
    binding.constants.retain(|constant| {
        let keep = !constants.contains(&constant.name);
        if !keep {
            refused.push((constant.name.clone(), "its value disagrees with the header".into()));
        }
        keep
    });
    binding.refused.extend(refused);
    Ok(())
}

/// Whatever named a dropped type goes too, until nothing more does.
fn cascade(bindings: &mut [Binding], mut dropped: BTreeSet<Name>) {
    loop {
        let mut more = BTreeSet::new();
        for binding in bindings.iter_mut() {
            let namespace = binding.namespace.clone();
            let mut refused = Vec::new();
            binding.types.retain(|decl| {
                let named = decl.uses().is_some_and(|uses| uses.iter().any(|u| dropped.contains(u)));
                if named {
                    more.insert((namespace.clone(), decl.name().to_owned()));
                    refused.push((decl.name().to_owned(), "it names a type that was dropped".into()));
                }
                !named
            });
            binding.functions.retain(|function| {
                let named = function.uses.iter().any(|u| dropped.contains(u));
                if named {
                    refused.push((function.name.clone(), "it names a type that was dropped".into()));
                }
                !named
            });
            binding.refused.extend(refused);
        }
        if more.is_empty() {
            break;
        }
        dropped.extend(more);
    }
}
