//! Compose the existing emitters around one snapshot and raw lowering.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_codegen_common::Backend;
use nts_core::hir;

use super::emission::{Input, Metadata, Report};
use super::{
    Emission, emit_c_prepared, emit_jvm_prepared, host_arch, host_os, llvm_platform, project_to,
    provider_for, wasm,
};

struct BackendEmission<'a> {
    backend: Backend,
    emission: Emission<'a>,
    host: Option<nts_codegen_wasm::Host>,
    text: bool,
}

struct Request {
    out: Utf8PathBuf,
    backends: Vec<Backend>,
}

/// Read each value once, before acquisition can spawn anything. An option's
/// value cannot accidentally become the positional project.
fn value(args: &[String], flag: &str) -> Result<String> {
    let mut found = None;
    for (at, arg) in args.iter().enumerate() {
        let candidate = if arg == flag {
            args.get(at + 1)
                .filter(|next| !next.starts_with("--"))
                .map(String::as_str)
                .with_context(|| format!("{flag} needs a value"))?
        } else if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
            value
        } else {
            continue;
        };
        if candidate.is_empty() {
            bail!("{flag} needs a nonempty value");
        }
        if found.replace(candidate.to_owned()).is_some() {
            bail!("{flag} is given more than once");
        }
    }
    found.with_context(|| format!("emit requires {flag}"))
}

impl Request {
    fn parse(args: &[String]) -> Result<Self> {
        let mut backends = Vec::new();
        for name in value(args, "--backends")?.split(',') {
            let backend: Backend = name.parse()?;
            if backends.contains(&backend) {
                bail!("backend `{name}` is requested more than once");
            }
            backends.push(backend);
        }
        Ok(Self {
            out: value(args, "--out")?.into(),
            backends,
        })
    }
}

fn settings<'a>(
    backend: Backend,
    args: &[String],
    mut emission: Emission<'a>,
) -> Result<BackendEmission<'a>> {
    // Incompatible provider and host requests belong to this backend, not to
    // the shared input: native emissions still run under a mixed --rc request.
    provider_for(backend)?;
    let host = if backend == Backend::Wasm {
        Some(wasm::selected_host(args)?)
    } else {
        None
    };
    if backend == Backend::Llvm {
        let os = args
            .windows(2)
            .find(|pair| pair[0] == "--os")
            .map_or(host_os(), |pair| pair[1].as_str());
        emission.llvm = Some(llvm_platform(os, host_arch()));
    }
    Ok(BackendEmission {
        backend,
        emission,
        host,
        text: args.iter().any(|arg| arg == "--text"),
    })
}

fn prepare(
    raw: &mut Option<hir::RawProgram>,
    metadata: &Metadata,
    backend: Backend,
    emission: Emission<'_>,
    last: bool,
    report: &mut Report,
) -> Result<hir::Prepared> {
    let options = metadata.options(emission, backend)?;
    let prepared = if last {
        let owned = raw.take().context("raw program was already consumed")?;
        owned.into_prepared(&options)
    } else {
        raw.as_ref()
            .context("raw program was already consumed")?
            .prepare(&options)
    };
    prepared.map_err(|error| super::emission::refused(&metadata.sources, &error, report))
}

fn emit(
    prepared: hir::Prepared,
    metadata: &Metadata,
    settings: &BackendEmission<'_>,
    out: &Utf8Path,
    report: &mut Report,
) -> Result<()> {
    match settings.backend {
        Backend::C | Backend::Llvm => emit_c_prepared(
            prepared,
            &metadata.sources,
            Some(out),
            settings.emission,
            report,
        )
        .map(drop),
        Backend::Jvm => emit_jvm_prepared(
            prepared,
            &metadata.sources,
            Some(out),
            settings.text,
            settings.emission,
            report,
        )
        .map(drop),
        Backend::Wasm => wasm::emit_prepared(
            prepared,
            &metadata.sources,
            out,
            settings.host.context("missing Wasm host")?,
            report,
        ),
    }
}

fn print_streams(backend: &str, report: &Report) {
    for line in report.stdout.lines() {
        println!("[{backend}] {line}");
    }
    for line in report.stderr.lines() {
        eprintln!("[{backend}] {line}");
    }
}

pub(super) fn command(args: &[String], emission: Emission<'_>) -> Result<()> {
    let request = Request::parse(args)?;
    let setups: Vec<_> = request
        .backends
        .iter()
        .map(|backend| settings(*backend, args, emission))
        .collect();
    let last_viable = setups.iter().rposition(Result::is_ok);
    let mut shared = Report::default();
    let input = last_viable.map(|_| {
        project_to(args, &mut shared)
            .and_then(|project| Input::open(&project, emission, &mut shared))
    });
    let (mut raw, metadata, shared_error) = match input {
        Some(Ok(Input { raw, metadata })) => (Some(raw), Some(metadata), None),
        Some(Err(error)) => {
            shared.err(format_args!("Error: {error:?}"));
            (None, None, Some(error.to_string()))
        }
        None => (None, None, None),
    };
    print_streams("frontend", &shared);
    let mut backends = serde_json::Map::new();
    let mut failed = Vec::new();
    for (index, (backend, setup)) in request.backends.iter().copied().zip(setups).enumerate() {
        let mut report = Report::default();
        let out = request.out.join(backend.name());
        let blocked = shared_error.is_some() && setup.is_ok();
        let has_shared = setup.is_ok();
        let result = setup.and_then(|settings| {
            let metadata = metadata
                .as_ref()
                .context("shared frontend/lowering failed")?;
            let prepared = prepare(
                &mut raw,
                metadata,
                backend,
                settings.emission,
                last_viable == Some(index),
                &mut report,
            )?;
            emit(prepared, metadata, &settings, &out, &mut report)
        });
        let status = if blocked {
            "blocked"
        } else if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        if let Err(error) = &result {
            if !blocked {
                report.err(format_args!("Error: {error:?}"));
            }
            failed.push(backend.name());
        }
        print_streams(backend.name(), &report);
        backends.insert(backend.name().to_owned(), serde_json::json!({
            "directory": backend.name(), "status": status,
            "exit_code": if result.is_ok() { 0 } else { 1 },
            "stdout": format!("{}{}", if has_shared { shared.stdout.as_str() } else { "" }, report.stdout),
            "stderr": format!("{}{}", if has_shared { shared.stderr.as_str() } else { "" }, report.stderr),
        }));
    }
    std::fs::create_dir_all(&request.out)?;
    std::fs::write(
        request.out.join("emit.json"),
        serde_json::to_vec_pretty(&serde_json::json!({ "version": 1, "backends": backends }))?,
    )?;
    if !failed.is_empty() {
        bail!(
            "emission failed for {}; see emit.json for each result",
            failed.join(", ")
        );
    }
    Ok(())
}
