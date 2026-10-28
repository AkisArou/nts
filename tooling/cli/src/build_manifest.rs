//! A build's missing behavior, recorded independently of diagnostic formatting.

use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};
use camino::Utf8Path;
use nts_diagnostics::{Diagnostic, Severity, SourceFile};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
struct Refusal {
    stage: &'static str,
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<u32>,
}

#[derive(Debug, Default)]
pub(super) struct Refusals(BTreeSet<Refusal>);

impl Refusals {
    pub(super) fn prepared(prepared: &nts_core::hir::Prepared, sources: &[SourceFile]) -> Self {
        let mut refusals = Self::default();
        refusals.diagnostics("lowering", &prepared.diagnostics, sources);
        for entry in prepared.program.refused_bodies() {
            refusals.named("lowering", &entry.name, &entry.reason);
        }
        refusals
    }

    pub(super) fn diagnostics(
        &mut self,
        stage: &'static str,
        diagnostics: &[Diagnostic],
        sources: &[SourceFile],
    ) {
        for diagnostic in diagnostics.iter().filter(|d| d.severity == Severity::Error) {
            self.0.insert(Refusal {
                stage,
                code: diagnostic.code.clone(),
                message: diagnostic.message.clone(),
                // Display paths are machine-local. Workspace URIs and source
                // spans give the manifest the same identity as the program.
                source: sources
                    .get(diagnostic.primary.file.0 as usize)
                    .map(|s| s.uri.clone()),
                start: Some(diagnostic.primary.span.start),
                end: Some(diagnostic.primary.span.end),
            });
        }
    }

    pub(super) fn named(&mut self, stage: &'static str, name: &str, reason: &str) {
        self.0.insert(Refusal {
            stage,
            code: String::new(),
            message: format!("`{name}`: {reason}"),
            source: None,
            start: None,
            end: None,
        });
    }

    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(super) fn len(&self) -> usize {
        self.0.len()
    }

    pub(super) fn require_complete(&self, allow_partial: bool) -> Result<()> {
        if allow_partial || self.is_empty() {
            return Ok(());
        }
        let lines = self
            .0
            .iter()
            .map(|r| format!("  {} {}: {}", r.stage, r.code, r.message))
            .collect::<Vec<_>>();
        bail!(
            "refusing to build a partial program: {} refusal record(s)\n{}\n\
             use --partial only to build the cut program for experiments",
            self.len(),
            lines.join("\n")
        )
    }

    pub(super) fn write(
        &self,
        out: &Utf8Path,
        product: &str,
        backend: &str,
        target: &str,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Manifest<'a> {
            schema: u32,
            product: &'a str,
            backend: &'a str,
            target: &'a str,
            partial: bool,
            refusals: &'a BTreeSet<Refusal>,
        }
        let manifest = Manifest {
            schema: 1,
            product,
            backend,
            target,
            partial: !self.is_empty(),
            refusals: &self.0,
        };
        let path = out.join("build-manifest.json");
        let mut bytes = serde_json::to_vec_pretty(&manifest)?;
        bytes.push(b'\n');
        std::fs::write(&path, bytes).with_context(|| format!("writing {path}"))
    }
}
