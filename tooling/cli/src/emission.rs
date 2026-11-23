//! Input acquisition and reporting shared by the existing emit commands.

use std::fmt::{Arguments, Write as _};

use anyhow::{Result, bail};
use camino::Utf8Path;
use nts_codegen_common::Backend;
use nts_core::hir;
use nts_diagnostics::{Severity, SourceFile, SourceLocations};
use nts_differential::case_costs;

use super::{
    Emission, Shape, configured_surface_to, foreign_tables, frontend_for, provider_for,
    selected_roots,
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
            roots: product_roots(emission.shape, self.entry.as_deref(), self.configured),
            callbacks_checkpoint: matches!(backend, Backend::C | Backend::Llvm)
                && emission.host.checkpoints_after_callbacks(),
            targets: emission.scalar_targets(),
            provided: provided(backend),
            ..hir::PreparationOptions::new(backend)
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
    })
}

/// The roots a product is prepared from: who can call into it.
///
/// **The product's shape answers, not the flag that named the roots.** An
/// executable has no outside, so its named entries are closed roots
/// (`Roots::Entry`): nothing but the program calls them, and nothing the
/// program hands back is called by anyone else. A Node-API addon or a library
/// is entered by its host, so the same names are a declared surface
/// (`Roots::Declared`): the host calls them with arguments the program does
/// not show, and calls what they return -- a closure's entries, a generator's
/// resume. `--entry` narrows which functions those are; it does not close the
/// product.
///
/// With no names, a configured product's surface is its entry's exports, and
/// an unconfigured library may have any export called from outside.
pub(super) fn product_roots(
    shape: Shape,
    entry: Option<&[String]>,
    configured: bool,
) -> hir::reachable::Roots<'_> {
    match (entry, shape) {
        (Some(names), Shape::Executable) => hir::reachable::Roots::Entry(names),
        (Some(names), Shape::Addon | Shape::Library) => hir::reachable::Roots::Declared(names),
        (None, _) if configured => hir::reachable::Roots::EntrySurface,
        (None, _) => hir::reachable::Roots::EveryExport,
    }
}

/// A product is the program its source says, or none: a builtin no provider
/// here supplies (NTS1100), or one no target ever will (NTS1101), stops
/// `nts build` before anything is written. Left to the lowering's usual
/// course, the function reaching it would be refused and every statement
/// calling that dropped, and the artifact would do less than its source says
/// on C, LLVM and the JVM. The
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
        let capture = case_costs::span("capture");
        let mut source = frontend_for(tsconfig)?;
        let snapshot = super::capture_project(&mut source, tsconfig)?;
        drop(source);
        snapshot_diagnostics(&snapshot, report)?;
        drop(capture);
        let _lower = case_costs::span("lower");
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
        let _prepare = case_costs::span("prepare");
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

#[cfg(test)]
mod tests {
    use super::{Shape, product_roots};
    use nts_core::hir::reachable::Roots;

    /// Each shape's named roots: closed for an executable alone. A named entry
    /// never decides the variant; the product does.
    #[test]
    fn the_shape_decides_whether_named_roots_are_closed() {
        let names = vec!["work".to_owned(), "module#init".to_owned()];
        for configured in [false, true] {
            assert!(matches!(
                product_roots(Shape::Executable, Some(&names), configured),
                Roots::Entry(roots) if roots == names.as_slice()
            ));
            for host_entered in [Shape::Addon, Shape::Library] {
                assert!(
                    matches!(
                        product_roots(host_entered, Some(&names), configured),
                        Roots::Declared(roots) if roots == names.as_slice()
                    ),
                    "{host_entered:?}"
                );
            }
        }
    }

    /// With no names, the product's surface is its config's entry, or every export.
    #[test]
    fn without_names_the_surface_is_the_configured_entry_or_every_export() {
        for shape in [Shape::Executable, Shape::Addon, Shape::Library] {
            assert!(matches!(
                product_roots(shape, None, true),
                Roots::EntrySurface
            ));
            assert!(matches!(
                product_roots(shape, None, false),
                Roots::EveryExport
            ));
        }
    }
}
