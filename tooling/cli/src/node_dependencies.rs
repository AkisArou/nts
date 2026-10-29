//! Native clients share the embedded upstream dependency executor.
use anyhow::{Context, Result, bail};
use camino::Utf8Path;
use nts_build::node_deps::{self, Artifacts, Request};
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

pub(super) fn command(args: &[String]) -> Result<()> {
    let [path] = args else {
        bail!("usage: nts node-deps <request.json>");
    };
    let request: Request = serde_json::from_slice(&std::fs::read(path)?)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&node_deps::ensure(&request)?)?
    );
    Ok(())
}

pub(super) fn for_build(
    target: &nts_build::config::Target,
    tools: &super::Toolchain,
    wrote: &super::Wrote,
    needs: &nts_build::dependencies::Resolution,
) -> Result<Option<Artifacts>> {
    let mut libraries: Vec<String> = wrote
        .libraries
        .iter()
        .filter_map(|s| node_deps::library_for(&format!("-l{s}")))
        .map(str::to_owned)
        .collect();
    libraries.extend(
        needs
            .libs
            .iter()
            .filter_map(|s| node_deps::library_for(s))
            .map(str::to_owned),
    );
    if wrote
        .sources
        .iter()
        .any(|s| s == nts_codegen_c::UV_HOST_SOURCE_NAME)
    {
        libraries.push("uv".into());
    }
    libraries.sort();
    libraries.dedup();
    if libraries.is_empty() {
        return Ok(None);
    }
    let plan = plan_for_target(target)?;
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .map_or_else(
            || {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".cache"))
                    .context("native dependency cache needs HOME or XDG_CACHE_HOME")
            },
            |path| Ok(PathBuf::from(path)),
        )?
        .join("nts/node-deps");
    let mut flags = tools.cpu.clone();
    if tools.lto {
        flags.extend(super::lto_flags());
    }
    let request = Request {
        target: plan.target.clone(),
        compiler: std::iter::once(tools.program.clone())
            .chain(tools.leading.clone())
            .collect(),
        archiver: vec!["llvm-ar".into()],
        flags,
        libraries,
        cache,
        jobs: 4,
    };
    node_deps::ensure(&request).map(Some)
}

fn plan_for_target(target: &nts_build::config::Target) -> Result<&'static node_deps::Recipe> {
    let arch = target.arch.as_deref().unwrap_or(super::host_arch());
    let triple = match target.os.as_str() {
        "linux" => format!(
            "{arch}-unknown-linux-{}",
            if target.id == "linux-musl" {
                "musl"
            } else {
                "gnu"
            }
        ),
        "windows" => format!("{arch}-pc-windows-gnu"),
        "macos" => format!("{arch}-apple-darwin"),
        "ios" if arch == "x86_64" => "x86_64-apple-ios-simulator".to_owned(),
        _ => bail!(
            "bundled Node dependencies have no verified plan for {}",
            target.id
        ),
    };
    node_deps::recipe_for(&triple)
}

/// Keep the archive closure private with the output's existing export contract
/// when the linker driver does not implement archive exclusion.
pub(super) fn link(
    command: &mut Command,
    artifacts: &Artifacts,
    tools: &super::Toolchain,
    kind: &str,
    out: &Utf8Path,
) -> Result<()> {
    let driver = tools
        .linker
        .as_ref()
        .and_then(|words| words.first())
        .unwrap_or(&tools.program);
    let exports = Utf8Path::new(driver).file_name() == Some("zig")
        && node_deps::recipe_for(&artifacts.target)?.object_format == node_deps::ObjectFormat::Elf;
    command.args(
        artifacts
            .link_flags
            .iter()
            .filter(|flag| !exports || flag.as_str() != "-Wl,--exclude-libs,ALL"),
    );
    if !exports {
        return Ok(());
    }
    if kind == "shared-library" {
        // hide_all_but_the_exports already wrote the exact public surface.
        if !command
            .get_args()
            .any(|arg| arg.to_string_lossy().starts_with("-Wl,--version-script="))
        {
            bail!("shared bundled libraries require their explicit ELF export map");
        }
        return Ok(());
    }
    let public = if kind == "node-addon" {
        vec![
            "napi_register_module_v1".to_owned(),
            "node_api_module_get_api_version_v1".to_owned(),
        ]
    } else {
        vec!["main".to_owned()]
    };
    let map = out.join("node-deps-exports.map");
    std::fs::write(&map, super::version_script(&public))?;
    command.arg(format!(
        "-Wl,--version-script={}",
        super::native_paths::relative(&map, out)?
    ));
    Ok(())
}

pub(super) fn notices(artifacts: &Artifacts, out: &Utf8Path) -> Result<()> {
    for (relative, source) in &artifacts.notices {
        let destination = out.join("notices").join(relative);
        std::fs::create_dir_all(destination.parent().context("notice parent")?)?;
        std::fs::copy(source, destination)?;
    }
    std::fs::write(
        out.join("node-deps.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "node": artifacts.node, "source_sha256": artifacts.source_sha256,
            "target": artifacts.target,
            "libraries": artifacts.archives.iter().filter_map(|p| p.file_name())
                .map(|name| name.to_string_lossy().into_owned()).collect::<Vec<_>>(),
        }))?,
    )?;
    Ok(())
}

/// A static nts library carries its selected dependency members to its consumer.
pub(super) fn merge(artifacts: &Artifacts, archive: &Utf8Path) -> Result<()> {
    use std::fmt::Write as _;
    let directory = super::bind_scratch::directory("node-static-closure")?;
    let mut script = String::from("CREATE combined.a\n");
    for (index, input) in std::iter::once(archive.as_std_path())
        .chain(artifacts.archives.iter().map(PathBuf::as_path))
        .enumerate()
    {
        let name = format!("input{index}.a");
        std::fs::copy(input, directory.join(&name))?;
        writeln!(script, "ADDLIB {name}")?;
    }
    script.push_str("SAVE\nEND\n");
    let mut child = Command::new("llvm-ar")
        .arg("-M")
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .context("archive script input")?
        .write_all(script.as_bytes())?;
    let result = child.wait_with_output()?;
    if !result.status.success() {
        bail!(
            "merging bundled Node archives: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    std::fs::copy(directory.join("combined.a"), archive)?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}
