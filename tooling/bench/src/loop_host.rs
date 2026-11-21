//! The libuv host a promised workload's native columns run on.
//!
//! A standalone program's `main` installs the libuv host before module
//! evaluation and runs its loop after (`nts_codegen_c`'s `main_for`). A
//! benchmark has no `main` of the program's own -- the harness calls the
//! workload -- so a workload that answers with a promise is given the same
//! host by `benchmarks/common/settle.c`, which joins each call's promise on
//! it. The host and libuv are the ones `nts build` links: `nts_uv_host.c`
//! from the runtime, and libuv built from Node's bundled sources into the
//! shared native dependency cache, with the flags this harness compiles with.
//! Never a system libuv.
use anyhow::{Context, Result};
use camino::{Utf8Path, Utf8PathBuf};
use std::sync::OnceLock;

/// What a promised workload's native build adds to every other case's.
pub(super) struct LoopHost {
    /// Translation units: the libuv host and the join.
    pub(super) sources: Vec<Utf8PathBuf>,
    /// libuv's include directories.
    pub(super) include_flags: Vec<String>,
    /// libuv's archive and its system libraries.
    pub(super) link_flags: Vec<String>,
}

/// The host, its sources written beside the runtime's in `out` and libuv
/// ensured once per process: every case shares one build directory.
pub(super) fn loop_host(root: &Utf8Path, out: &Utf8Path) -> Result<&'static LoopHost> {
    static HOST: OnceLock<LoopHost> = OnceLock::new();
    if let Some(host) = HOST.get() {
        return Ok(host);
    }
    for (name, text) in [
        (
            nts_codegen_c::UV_HOST_HEADER_NAME,
            nts_codegen_c::UV_HOST_HEADER,
        ),
        (
            nts_codegen_c::UV_HOST_SOURCE_NAME,
            nts_codegen_c::UV_HOST_SOURCE,
        ),
    ] {
        let path = out.join(name);
        std::fs::write(&path, text).with_context(|| format!("writing {path}"))?;
    }
    let artifacts = libuv()?;
    let host = LoopHost {
        sources: vec![
            out.join(nts_codegen_c::UV_HOST_SOURCE_NAME),
            root.join("benchmarks/common/settle.c"),
        ],
        include_flags: artifacts.include_flags,
        link_flags: artifacts.link_flags,
    };
    Ok(HOST.get_or_init(|| host))
}

/// libuv for this machine, compiled as the harness compiles everything else:
/// optimized for the host CPU and with LTO, the flags `nts build` gives it.
fn libuv() -> Result<nts_build::node_deps::Artifacts> {
    let target = format!("{}-unknown-linux-gnu", std::env::consts::ARCH);
    let recipe = nts_build::node_deps::recipe_for(&target)?;
    let cpu: &[&str] = if std::env::consts::ARCH == "x86_64" {
        nts_codegen_common::compile_flags::X86_64_V3
    } else {
        &[]
    };
    let flags = cpu
        .iter()
        .chain(nts_codegen_common::compile_flags::LTO)
        .map(|flag| (*flag).to_owned())
        .collect();
    nts_build::node_deps::ensure(&nts_build::node_deps::Request {
        target: recipe.target.clone(),
        compiler: vec!["clang".to_owned()],
        archiver: vec!["llvm-ar".to_owned()],
        flags,
        libraries: vec!["uv".to_owned()],
        cache: nts_build::node_deps::cache_from_environment(|name| std::env::var_os(name))?,
        jobs: 4,
    })
    .context("building the bundled libuv a promised workload runs on")
}
