//! Asking clang what the headers say. Each question is a declaration whose
//! name starts with a prefix no header uses (`__typeof__(F) ntswinmd_fn_F;`),
//! and `-ast-dump-filter` prints only those, so a probe of all of
//! `windows.h` is a fraction of a second. clang desugars one typedef per
//! answer, so the names still left in the answers are asked about in the
//! next round, until none are.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use anyhow::{Context, Result};

use super::ctype;

/// One probe declaration's answer: its name, the type clang gives it, and
/// for an enumerator its evaluated value.
pub(crate) struct Answer {
    pub(crate) name: String,
    pub(crate) qual: String,
    pub(crate) desugared: Option<String>,
    pub(crate) value: Option<u32>,
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

/// What one binder asks with: the lines that bring its headers in, the
/// compiler's arguments, and the prefix every question's name starts with.
pub(crate) struct Probe<'a> {
    pub(crate) preamble: &'a [String],
    pub(crate) clang_args: &'a [String],
    pub(crate) prefix: &'a str,
    /// The binder asking, for its scratch directory: `bind-winmd`.
    pub(crate) label: &'a str,
}

impl Probe<'_> {
    /// One clang run over the preamble and `declarations`, answering with
    /// each question's type spelling and, for an enumerator, its value.
    pub(crate) fn ask(&self, declarations: &str) -> Result<Vec<Answer>> {
        let dir = crate::bind_scratch::directory(self.label)?;
        let probe = dir.join("probe.c");
        let mut text = String::new();
        for line in self.preamble {
            let _ = writeln!(text, "{line}");
        }
        text.push_str(declarations);
        std::fs::write(&probe, &text).with_context(|| format!("writing {}", probe.display()))?;
        // Probes that name nothing fail to compile; the AST still holds every one
        // that did, which is the answer. `-ferror-limit=0` lets all of them try.
        let output = std::process::Command::new("clang")
            .args(self.clang_args)
            .args([
                "-fsyntax-only",
                "-ferror-limit=0",
                "-w",
                "-Xclang",
                "-ast-dump=json",
                "-Xclang",
            ])
            .arg(format!("-ast-dump-filter={}", self.prefix))
            .arg(&probe)
            .output()
            .with_context(|| format!("running clang to read the headers for {}", self.label))?;
        let _ = std::fs::remove_dir_all(&dir);
        let text = String::from_utf8_lossy(&output.stdout);
        let mut answers = Vec::new();
        let mut decoder =
            serde_json::Deserializer::from_str(&text).into_iter::<serde_json::Value>();
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

    /// The typedef chain, one round per level: what each name in `pending`
    /// is, and then every typedef name those answers still mention.
    pub(crate) fn typedefs(
        &self,
        mut pending: BTreeSet<String>,
    ) -> Result<BTreeMap<String, String>> {
        let prefix = self.prefix;
        let mut spellings = BTreeMap::new();
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
                let _ = writeln!(probes, "typedef {name} {prefix}td_{name};");
            }
            asked.extend(pending.iter().cloned());
            let mut next = BTreeSet::new();
            for answer in self.ask(&probes)? {
                let Some(name) = answer.name.strip_prefix(&format!("{prefix}td_")) else {
                    continue;
                };
                let resolved = answer.desugared.unwrap_or(answer.qual);
                next.extend(ctype::typedef_names(&resolved));
                spellings.insert(name.to_owned(), resolved);
            }
            pending = next;
        }
        Ok(spellings)
    }
}
