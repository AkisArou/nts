//! Metadata recorded by the same accepted publication branches as addon.c.
//!
//! This describes generated publication attempts, including conditional value
//! conversions. It does not claim that loading the addon initialized every key.

use serde::Serialize;
use std::fmt::Write as _;

pub(super) const FILE_NAME: &str = "addon.exports.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Kind {
    Function,
    Class,
    Value,
    Namespace,
}

/// One JavaScript property path, with the actual generated callback or reader.
#[derive(Debug, Serialize)]
pub(super) struct Export {
    pub(super) path: Vec<String>,
    pub(super) kind: Kind,
    pub(super) name: String,
    pub(super) arity: Option<u32>,
    pub(super) required: Option<u32>,
    pub(super) symbol: String,
}

impl Export {
    pub(super) fn class(
        key: &str,
        name: &str,
        instance: &str,
        constructor: &nts_core::hir::Func,
    ) -> Self {
        Self {
            path: vec![key.to_owned()],
            kind: Kind::Class,
            name: name.to_owned(),
            arity: Some(0),
            required: Some(
                u32::try_from(constructor.params.len().saturating_sub(1))
                    .expect("constructor arity"),
            ),
            symbol: format!("nts_napi_new_{instance}"),
        }
    }

    pub(super) fn value(path: Vec<String>, symbol: String) -> Self {
        Self {
            name: path.last().expect("a property path").clone(),
            path,
            kind: Kind::Value,
            arity: None,
            required: None,
            symbol,
        }
    }
}

/// Completed facts from the actual successful wrapper producer. Aliases share
/// this source identity and never revisit its parameter list.
pub(super) struct Function<'a> {
    pub(super) source: &'a nts_core::hir::Func,
    pub(super) symbol: String,
    pub(super) arity: u32,
    required: u32,
}

pub(super) struct FunctionBody<'a> {
    pub(super) text: String,
    pub(super) function: Function<'a>,
}

impl<'a> FunctionBody<'a> {
    pub(super) fn new(
        text: String,
        source: &'a nts_core::hir::Func,
        symbol: String,
        required: usize,
    ) -> Self {
        Self {
            text,
            function: Function {
                source,
                symbol,
                arity: super::published_arity(source),
                required: u32::try_from(required).expect("function arity"),
            },
        }
    }
}

impl Function<'_> {
    pub(super) fn export(&self, path: Vec<String>) -> Export {
        #[cfg(test)]
        ALIASES.with(|count| count.set(count.get() + 1));
        Export {
            name: path.last().expect("a property path").clone(),
            path,
            kind: Kind::Function,
            arity: Some(self.arity),
            required: Some(self.required),
            symbol: self.symbol.clone(),
        }
    }
}

#[cfg(test)]
thread_local! {
    static PARAMETERS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static ALIASES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[inline]
pub(super) fn parameter_visit() {
    #[cfg(test)]
    PARAMETERS.with(|count| count.set(count.get() + 1));
}

#[cfg(test)]
pub(super) fn take_work() -> (usize, usize) {
    (
        PARAMETERS.with(|count| count.replace(0)),
        ALIASES.with(|count| count.replace(0)),
    )
}

/// The argument counts consumed by both the wrapper and its manifest row.
pub(super) struct Arguments {
    pub(super) gathered: Option<usize>,
    pub(super) positional: usize,
    pub(super) required: usize,
}

impl Arguments {
    pub(super) fn of(func: &nts_core::hir::Func) -> Self {
        use nts_core::hir::ParamShape;
        let gathered = func.params.iter().position(|p| {
            parameter_visit();
            p.shape == ParamShape::Rest
        });
        let positional = gathered.unwrap_or(func.params.len());
        let required = func
            .params
            .iter()
            .take(positional)
            .rposition(|p| {
                parameter_visit();
                p.shape != ParamShape::Optional
            })
            .map_or(0, |at| at + 1);
        Self {
            gathered,
            positional,
            required,
        }
    }
}

#[derive(Debug, Default)]
pub struct Manifest {
    pub(super) exports: Vec<Export>,
}

#[derive(Serialize)]
struct Document<'a> {
    version: u32,
    source_sha256: String,
    exports_sha256: String,
    export_count: usize,
    exports: &'a [Export],
}

fn digest(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(64);
    for byte in hmac_sha256::Hash::hash(bytes) {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

impl Manifest {
    /// Hashes bind the complete rows to each other and to the actual glue file.
    /// Consumers reject a truncated or edited capsule before asking about it.
    #[must_use]
    pub fn json(&self, source: &str) -> String {
        let rows = serde_json::to_vec(&self.exports).expect("serializable export rows");
        let document = Document {
            version: 1,
            source_sha256: digest(source.as_bytes()),
            exports_sha256: digest(&rows),
            export_count: self.exports.len(),
            exports: &self.exports,
        };
        let mut out = serde_json::to_string_pretty(&document).expect("serializable manifest");
        out.push('\n');
        out
    }
}
