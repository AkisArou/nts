//! Input acquisition and reporting shared by the existing emit commands.

use std::fmt::{Arguments, Write as _};

use anyhow::{Result, bail};
use camino::Utf8Path;
use nts_codegen_common::Backend;
use nts_core::hir;
use nts_diagnostics::{Severity, SourceFile, SourceLocations};

use super::{
    Emission, configured_surface_to, foreign_tables, frontend_for, provider_for, selected_roots,
};

/// Live commands write directly; a combined command keeps each backend's exact
/// streams for the runner, without changing process-global file descriptors.
#[derive(Debug, Default)]
pub(super) struct Report {
    pub stdout: String,
    pub stderr: String,
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
        let provider = provider_for(backend)?;
        Ok(hir::PreparationOptions {
            provider,
            roots: self.entry.as_deref().map_or_else(
                || default_roots(self.configured, backend),
                hir::reachable::Roots::Entry,
            ),
            callbacks_checkpoint: matches!(backend, Backend::C | Backend::Llvm)
                && emission.host.checkpoints_after_callbacks(),
            targets: emission.scalar_targets(),
            table_entries: backend.table_entries(),
            provided: provided(backend),
            ..hir::PreparationOptions::default()
        })
    }
}

/// Which runtime helpers `backend` provides, for a `typeof` of an intrinsic
/// (`hir::features`): the C runtime's header for C and LLVM, each other
/// backend's own table. Every driver that prepares for a backend says, as it
/// says `table_entries`.
pub(super) fn provided(backend: Backend) -> hir::features::Provided {
    hir::features::Provided::By(match backend {
        Backend::C | Backend::Llvm => nts_codegen_llvm::provides,
        Backend::Jvm => nts_codegen_jvm::provides,
        Backend::Wasm => nts_codegen_wasm::provides,
    })
}

/// The roots of a build that names no `--entry`.
///
/// A configured project's product is its entry's surface. An unconfigured one
/// may be a library any of whose `export`s is called from outside, so every
/// `export` is a root -- except on Wasm, whose module publishes the entry's
/// exports and nothing else (`program.public_api`, walked by the emitter's
/// `module::emit`). Rooted at every `export`, a runtime module's exported
/// helpers kept their parameters as wide as a host caller could make them,
/// behind a `#whole` split, for a caller that does not exist: `node-utf8`'s
/// `utf8Write` and `utf8Decode`, 3.66% of the row (2026-10-20).
pub(super) fn default_roots(configured: bool, backend: Backend) -> hir::reachable::Roots<'static> {
    if configured || matches!(backend, Backend::Wasm) {
        hir::reachable::Roots::EntrySurface
    } else {
        hir::reachable::Roots::EveryExport
    }
}

/// A product is the program its source says, or none: a builtin no provider
/// here supplies (NTS1100), or one no target ever will (NTS1101), stops
/// `nts build` before anything is written. Left to the lowering's usual
/// course, the function reaching it would be refused and every statement
/// calling that dropped, and the artifact would do less than its source says
/// on C, LLVM and the JVM -- Wasm already declined such a program whole. The
/// inspection commands (`emit-c`, `hir`, `check`) still compile what they can:
/// what lowers is what they are for.
fn unprovided_stops_the_build(prepared: &hir::Prepared, sources: &[SourceFile]) -> Result<()> {
    let unprovided: Vec<&nts_diagnostics::Diagnostic> = prepared
        .diagnostics
        .iter()
        .filter(|diagnostic| matches!(diagnostic.code.as_str(), "NTS1100" | "NTS1101"))
        .collect();
    if unprovided.is_empty() {
        return Ok(());
    }
    let mut locations = nts_diagnostics::SourceLocations::new(sources);
    let lines: Vec<String> = unprovided
        .iter()
        .map(|diagnostic| locations.diagnostic_line(diagnostic))
        .collect();
    anyhow::bail!(
        "{}\n{} builtin(s) this compiler does not provide; a build is the program its source \
         says, so nothing was written",
        lines.join("\n"),
        unprovided.len()
    )
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
        let mut source = frontend_for(tsconfig)?;
        let snapshot = super::capture_project(&mut source, tsconfig)?;
        drop(source);
        snapshot_diagnostics(&snapshot, report)?;
        let entry = selected_roots(emission.shape);
        let (entry_files, configured) =
            match configured_surface_to(tsconfig, &snapshot, emission, report)? {
                Some(files) => (files, true),
                None => (nts_frontend_ts::entry_uris(tsconfig, &snapshot), false),
            };
        let foreign = foreign_tables(&snapshot)?;
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
        if emission.product.is_some() {
            unprovided_stops_the_build(&prepared, &self.metadata.sources)?;
        }
        Ok((prepared, self.metadata))
    }
}
