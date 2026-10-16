//! Input acquisition and reporting shared by the existing emit commands.

use std::fmt::{Arguments, Write as _};

use anyhow::{Result, bail};
use camino::Utf8Path;
use nts_codegen_common::Backend;
use nts_core::hir;
use nts_diagnostics::{Severity, SourceFile, SourceLocations};

use super::{
    Emission, configured_surface_to, foreign_tables_to, frontend_binary, frontend_for,
    selected_provider, selected_roots,
};

/// Live commands write directly; a combined command keeps each backend's exact
/// streams for the runner, without changing process-global file descriptors.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub(super) struct Report {
    pub stdout: String,
    pub stderr: String,
    #[serde(skip)]
    live: bool,
}

impl Report {
    pub(super) fn live() -> Self {
        Self {
            live: true,
            ..Self::default()
        }
    }

    pub(super) fn out(&mut self, args: Arguments<'_>) {
        if self.live {
            println!("{args}");
        } else {
            let _ = writeln!(self.stdout, "{args}");
        }
    }

    pub(super) fn err(&mut self, args: Arguments<'_>) {
        if self.live {
            eprintln!("{args}");
        } else {
            let _ = writeln!(self.stderr, "{args}");
        }
    }

    pub(super) fn text(&mut self, args: Arguments<'_>) {
        if self.live {
            print!("{args}");
        } else {
            let _ = write!(self.stdout, "{args}");
        }
    }
}

pub(super) fn snapshot_diagnostics(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    report: &mut Report,
) -> Result<()> {
    let mut locations = SourceLocations::new(&snapshot.sources);
    for diagnostic in &snapshot.diagnostics {
        if diagnostic.severity == Severity::Warning {
            report.err(format_args!(
                "warning: {}",
                locations.diagnostic_line(diagnostic)
            ));
        }
    }
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            report.err(format_args!("{}", locations.diagnostic_line(diagnostic)));
        }
        bail!("the program does not typecheck");
    }
    Ok(())
}

pub(super) fn refused(
    sources: &[SourceFile],
    unprepared: &hir::Unprepared,
    report: &mut Report,
) -> anyhow::Error {
    report.err(format_args!("{}", unprepared.render(sources)));
    match unprepared {
        hir::Unprepared::Rejected(errors) => {
            anyhow::anyhow!("the program does not compile: {} error(s)", errors.len())
        }
        hir::Unprepared::Invalid(_) => anyhow::anyhow!("refusing to emit code from invalid HIR"),
    }
}

/// Only source metadata and root selection survive raw lowering. Neither a
/// checker handle nor a snapshot is handed to the prepared emitters.
#[derive(Debug)]
pub(super) struct Metadata {
    pub sources: Vec<SourceFile>,
    entry: Option<Vec<String>>,
    configured: bool,
}

impl Metadata {
    pub(super) fn options(
        &self,
        emission: Emission<'_>,
        backend: Backend,
    ) -> Result<hir::PreparationOptions<'_>> {
        let provider = match backend {
            Backend::C | Backend::Llvm => selected_provider(),
            Backend::Jvm | Backend::Wasm => nts_codegen_common::provider::host_gc(
                backend.name(),
                selected_provider() == hir::Provider::ReferenceCounting,
            )
            .map_err(anyhow::Error::msg)?,
        };
        Ok(hir::PreparationOptions {
            provider,
            roots: self.entry.as_deref().map_or_else(
                || {
                    if self.configured {
                        hir::reachable::Roots::EntrySurface
                    } else {
                        hir::reachable::Roots::EveryExport
                    }
                },
                hir::reachable::Roots::Entry,
            ),
            callbacks_checkpoint: matches!(backend, Backend::C | Backend::Llvm)
                && emission.host.checkpoints_after_callbacks(),
            targets: emission.scalar_targets(),
            ..hir::PreparationOptions::default()
        })
    }
}

#[derive(Debug)]
pub(super) struct Input {
    pub raw: hir::RawProgram,
    pub metadata: Metadata,
}

impl Input {
    pub(super) fn open(
        tsconfig: &Utf8Path,
        emission: Emission<'_>,
        report: &mut Report,
    ) -> Result<Self> {
        let mut source = frontend_for(tsconfig, frontend_binary())?;
        let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
        drop(source);
        snapshot_diagnostics(&snapshot, report)?;
        let entry = selected_roots(emission.shape);
        let (entry_files, configured) =
            match configured_surface_to(tsconfig, &snapshot, emission, report)? {
                Some(files) => (files, true),
                None => (nts_frontend_ts::entry_uris(tsconfig, &snapshot), false),
            };
        let foreign = foreign_tables_to(&snapshot, report);
        let raw = hir::RawProgram::lower(&snapshot, &entry_files, &foreign);
        Ok(Self {
            raw,
            metadata: Metadata {
                sources: snapshot.sources,
                entry,
                configured,
            },
        })
    }

    pub(super) fn prepare(
        self,
        emission: Emission<'_>,
        backend: Backend,
        report: &mut Report,
    ) -> Result<(hir::Prepared, Metadata)> {
        let options = self.metadata.options(emission, backend)?;
        let prepared = self
            .raw
            .into_prepared(&options)
            .map_err(|error| refused(&self.metadata.sources, &error, report))?;
        Ok((prepared, self.metadata))
    }
}
