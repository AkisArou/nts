//! The wasm driver shares project acquisition and preparation with other emitters.

use super::{
    Emission, configured_surface, emit_options, foreign_tables, frontend_binary, frontend_for,
    project, refused, report_snapshot_diagnostics, selected_roots,
};
use anyhow::{Result, bail};
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_diagnostics::Severity;

pub(super) fn command(args: &[String], emission: Emission<'_>) -> Result<()> {
    if args.iter().any(|arg| arg == "--rc") {
        bail!("NTS5001: wasm declines --rc: its managed memory belongs to the host GC");
    }
    let Some(out) = args
        .windows(2)
        .find(|pair| pair[0] == "--out")
        .map(|pair| Utf8PathBuf::from(&pair[1]))
    else {
        bail!("emit-wasm requires --out <directory> for program.wasm, program.json and node.mjs");
    };
    let tsconfig = project(args)?;
    let mut source = frontend_for(&tsconfig, frontend_binary())?;
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, &tsconfig, "nts-build")?;
    report_snapshot_diagnostics(&snapshot)?;
    let entry = selected_roots(emission.shape);
    let (entry_files, configured) = match configured_surface(&tsconfig, &snapshot, emission)? {
        Some(files) => (files, Some(hir::reachable::Roots::EntrySurface)),
        None => (nts_frontend_ts::entry_uris(&tsconfig, &snapshot), None),
    };
    let foreign = foreign_tables(&snapshot);
    let mut options = emit_options(
        entry.as_deref(),
        &entry_files,
        &foreign,
        configured,
        false,
        emission.scalar_targets(),
    );
    // Scalar-only bring-up: no allocation placement can occur. Switch to the
    // approved shared HostGc provider after coordinated core review, before M1a lands.
    options.provider = hir::Provider::NoGc;
    let prepared = match hir::prepare_with(&snapshot, &options) {
        Ok(prepared) => prepared,
        Err(unprepared) => return Err(refused(&snapshot, &unprepared)),
    };
    for diagnostic in &prepared.diagnostics {
        eprintln!(
            "{}",
            nts_diagnostics::diagnostic_line(&snapshot.sources, diagnostic)
        );
    }
    if prepared
        .diagnostics
        .iter()
        .any(|d| d.severity == Severity::Error)
    {
        bail!("wasm preparation declined; no artifact written");
    }
    let emitted = match nts_codegen_wasm::emit(&prepared.program) {
        Ok(emitted) => emitted,
        Err(nts_codegen_wasm::EmitError::Declined(diagnostics)) => {
            for diagnostic in &diagnostics {
                eprintln!(
                    "{}",
                    nts_diagnostics::diagnostic_line(&snapshot.sources, diagnostic)
                );
            }
            bail!(
                "wasm declined {} shape(s); no artifact written",
                diagnostics.len()
            );
        }
        Err(error) => return Err(error.into()),
    };
    // All declines and both validators precede the first output mutation.
    let manifest = serde_json::to_vec_pretty(&emitted.manifest)?;
    let sources: Vec<_> = snapshot
        .sources
        .iter()
        .map(|s| {
            serde_json::json!({ "uri": s.uri, "digest": s.digest,
            "rewritten_by": s.rewritten_by, "rewritten_map": s.rewritten_map })
        })
        .collect();
    let origins = serde_json::to_vec_pretty(
        &serde_json::json!({ "sources": sources, "instructions": emitted.origins }),
    )?;
    std::fs::create_dir_all(&out)?;
    std::fs::write(out.join("program.wasm"), &emitted.bytes)?;
    std::fs::write(out.join("program.json"), manifest)?;
    std::fs::write(out.join("node.mjs"), nts_codegen_wasm::NODE_LOADER)?;
    std::fs::write(out.join("program.origins.json"), origins)?;
    println!(
        "wrote {} wasm bytes, {} function(s), {} global(s) and the Node loader to {out}",
        emitted.bytes.len(),
        emitted.manifest.exports.len(),
        emitted.manifest.globals.len()
    );
    Ok(())
}
