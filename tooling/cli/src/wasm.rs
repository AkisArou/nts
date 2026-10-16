//! The wasm driver shares project acquisition and preparation with other emitters.

use super::{Emission, project};
use anyhow::{Result, bail};
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_diagnostics::{Severity, SourceLocations};

pub(super) fn command(args: &[String], emission: Emission<'_>) -> Result<()> {
    let _provider =
        nts_codegen_common::provider::host_gc("wasm", args.iter().any(|arg| arg == "--rc"))
            .map_err(anyhow::Error::msg)?;
    let Some(out) = args
        .windows(2)
        .find(|pair| pair[0] == "--out")
        .map(|pair| Utf8PathBuf::from(&pair[1]))
    else {
        bail!("emit-wasm requires --out <directory> for program.wasm and its JS glue");
    };
    let host = selected_host(args)?;
    let tsconfig = project(args)?;
    let mut report = super::EmissionReport::live();
    let input = super::EmissionInput::open(&tsconfig, emission, &mut report)?;
    let (prepared, metadata) =
        input.prepare(emission, nts_codegen_common::Backend::Wasm, &mut report)?;
    emit_prepared(prepared, &metadata.sources, &out, host, &mut report)
}

pub(super) fn selected_host(args: &[String]) -> Result<nts_codegen_wasm::Host> {
    Ok(match host(args)?.as_deref() {
        None | Some("node") => nts_codegen_wasm::Host::Node,
        Some("browser") => nts_codegen_wasm::Host::Browser,
        Some(other) => bail!("emit-wasm --host must be `node` or `browser`, not `{other}`"),
    })
}

pub(super) fn emit_prepared(
    prepared: hir::Prepared,
    sources: &[nts_diagnostics::SourceFile],
    out: &camino::Utf8Path,
    host: nts_codegen_wasm::Host,
    report: &mut super::EmissionReport,
) -> Result<()> {
    let mut locations = SourceLocations::new(sources);
    for diagnostic in &prepared.diagnostics {
        report.err(format_args!("{}", locations.diagnostic_line(diagnostic)));
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
                report.err(format_args!("{}", locations.diagnostic_line(diagnostic)));
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
    let sources: Vec<_> = sources
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
    report.out(format_args!(
        "wrote {} wasm bytes, {} function(s), {} global(s) and their JS glue to {out}",
        emitted.bytes.len(),
        emitted.manifest.exports.len(),
        emitted.manifest.globals.len()
    ));
    // **Said, not refused.** A published name the boundary cannot carry is left
    // out of the module while every body compiles, as `emit-c` leaves out a name
    // with no symbol, so it is a note here in C's shape rather than an NTS line
    // on stderr: tools read one of those as code that was not compiled, and the
    // test262 runner judged 63 programs that compiled and ran refused for it.
    for declined in &emitted.declined {
        let at = declined
            .at
            .map(|at| format!(" (declared at {})", locations.where_it_is(&at)))
            .unwrap_or_default();
        report.out(format_args!(
            "  `{}` is exported but the module does not publish it: {}{at}",
            declined.name, declined.reason
        ));
    }
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
