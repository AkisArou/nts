//! The wasm driver shares project acquisition and preparation with other emitters.

use super::{
    Emission, configured_surface, emit_options, foreign_tables, frontend_binary, frontend_for,
    project, refused, report_snapshot_diagnostics, selected_roots,
};
use anyhow::{Result, bail};
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_diagnostics::{Severity, SourceLocations};

pub(super) fn command(args: &[String], emission: Emission<'_>) -> Result<()> {
    let provider =
        nts_codegen_common::provider::host_gc("wasm", args.iter().any(|arg| arg == "--rc"))
            .map_err(anyhow::Error::msg)?;
    let Some(out) = args
        .windows(2)
        .find(|pair| pair[0] == "--out")
        .map(|pair| Utf8PathBuf::from(&pair[1]))
    else {
        bail!("emit-wasm requires --out <directory> for program.wasm and its JS glue");
    };
    let host = match host(args)?.as_deref() {
        None | Some("node") => nts_codegen_wasm::Host::Node,
        Some("browser") => nts_codegen_wasm::Host::Browser,
        Some(other) => bail!("emit-wasm --host must be `node` or `browser`, not `{other}`"),
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
    options.provider = provider;
    let prepared = match hir::prepare_with(&snapshot, &options) {
        Ok(prepared) => prepared,
        Err(unprepared) => return Err(refused(&snapshot, &unprepared)),
    };
    let mut locations = SourceLocations::new(&snapshot.sources);
    for diagnostic in &prepared.diagnostics {
        eprintln!("{}", locations.diagnostic_line(diagnostic));
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
                eprintln!("{}", locations.diagnostic_line(diagnostic));
            }
            bail!(
                "wasm declined {} shape(s); no artifact written",
                diagnostics.len()
            );
        }
        Err(error) => return Err(error.into()),
    };
    // All declines, both validators and the glue precede the first output
    // mutation.
    let glue = nts_codegen_wasm::glue(&emitted.manifest, host).map_err(anyhow::Error::msg)?;
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
    std::fs::write(out.join(nts_codegen_wasm::PROGRAM_FILE), glue.program)?;
    std::fs::write(out.join(nts_codegen_wasm::INSTANCE_FILE), glue.instance)?;
    std::fs::write(out.join("program.wasm.json"), manifest)?;
    std::fs::write(out.join("program.origins.json"), origins)?;
    println!(
        "wrote {} wasm bytes, {} function(s), {} global(s) and their JS glue to {out}",
        emitted.bytes.len(),
        emitted.manifest.exports.len(),
        emitted.manifest.globals.len()
    );
    Ok(())
}

/// The `--host` value, as `--host <value>` or `--host=<value>`. Given twice,
/// or with no value, it is an error rather than a silent default.
fn host(args: &[String]) -> Result<Option<String>> {
    let mut found = None;
    for (at, arg) in args.iter().enumerate() {
        let value = if arg == "--host" {
            let Some(value) = args.get(at + 1) else {
                bail!("emit-wasm --host needs a value: `node` or `browser`");
            };
            value.clone()
        } else if let Some(value) = arg.strip_prefix("--host=") {
            value.to_owned()
        } else {
            continue;
        };
        if found.replace(value).is_some() {
            bail!("emit-wasm --host is given more than once");
        }
    }
    Ok(found)
}
