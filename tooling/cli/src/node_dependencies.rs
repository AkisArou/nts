//! Native clients share the embedded upstream dependency executor.
use anyhow::{Context, Result, bail};
use camino::Utf8Path;
use nts_build::node_deps::{self, Artifacts, Request};
use std::{
    io::Write,
    path::{Path, PathBuf},
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
    let cache = node_deps::cache_from_environment(|name| std::env::var_os(name))?;
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
    scoped: bool,
) -> Result<()> {
    let driver = tools
        .linker
        .as_ref()
        .and_then(|words| words.first())
        .unwrap_or(&tools.program);
    let format = node_deps::recipe_for(&artifacts.target)?.object_format;
    let exports =
        Utf8Path::new(driver).file_name() == Some("zig") && format == node_deps::ObjectFormat::Elf;
    command.args(link_arguments(
        &artifacts.link_flags,
        format,
        exports,
        scoped,
    ));
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

// A static link has no DSO to omit. Zig's cc driver rejects state push/pop,
// even though its underlying lld supports them, so its dynamic policy stays
// unchanged as well. Other native ELF drivers can scope libm alone.
pub(super) fn scopes_math(command: &Command) -> bool {
    Path::new(command.get_program())
        .file_name()
        .is_none_or(|name| name != "zig")
        && !command.get_args().any(|arg| arg == "-static")
}

/// Called by the ELF application link owner after every library input.
pub(super) fn finish_elf_math(command: &mut Command, scoped: bool) {
    if scoped {
        command.args(["-Wl,--push-state,--as-needed", "-lm", "-Wl,--pop-state"]);
    }
}

fn link_arguments(
    flags: &[String],
    format: node_deps::ObjectFormat,
    exports: bool,
    scoped: bool,
) -> Vec<&str> {
    let mut arguments = Vec::new();
    for flag in flags {
        if exports && flag == "-Wl,--exclude-libs,ALL" {
            continue;
        }
        if scoped && format == node_deps::ObjectFormat::Elf && flag == "-lm" {
            // The application's link owner emits math once after all inputs.
            // Even this archive closure may be followed by another library.
            continue;
        }
        arguments.push(flag.as_str());
    }
    arguments
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

#[cfg(test)]
mod cache_tests {
    use nts_build::node_deps::cache_from_environment;
    use std::{ffi::OsString, path::PathBuf};

    #[test]
    fn missing_fixture_cache_never_reads_production_paths() {
        let error = cache_from_environment(|name| match name {
            "NTS_NODE_DEPS_CACHE" => None,
            "NTS_TEST_ENVIRONMENT" => Some(OsString::from("1")),
            _ => panic!("production environment read: {name}"),
        })
        .expect_err("a fixture must declare its native dependency cache");
        assert_eq!(
            error.to_string(),
            "fixture cache capability missing: NTS_NODE_DEPS_CACHE"
        );
    }

    #[test]
    fn declared_cache_never_reads_production_paths() {
        let cache = cache_from_environment(|name| match name {
            "NTS_NODE_DEPS_CACHE" => Some(OsString::from("/declared/cache")),
            _ => panic!("production environment read: {name}"),
        })
        .expect("the declared cache must resolve");
        assert_eq!(cache, PathBuf::from("/declared/cache"));
    }

    #[test]
    fn production_keeps_its_xdg_cache() {
        let cache = cache_from_environment(|name| match name {
            "XDG_CACHE_HOME" => Some(OsString::from("/production/cache")),
            "HOME" => panic!("XDG cache needs no HOME"),
            _ => None,
        })
        .expect("the production XDG cache must resolve");
        assert_eq!(cache, PathBuf::from("/production/cache/nts/node-deps"));
    }
}

#[cfg(test)]
mod link_tests {
    use super::{finish_elf_math, link_arguments, scopes_math};
    use nts_build::node_deps::ObjectFormat;
    use std::process::Command;

    #[test]
    fn elf_math_is_emitted_once_after_all_library_inputs() {
        let flags: Vec<String> = [
            "-lconstructor",
            "uv.a",
            "-lm",
            "-ldl",
            "-lm",
            "-Wl,--exclude-libs,ALL",
        ]
        .map(str::to_owned)
        .to_vec();
        for format in [ObjectFormat::Elf, ObjectFormat::Macho, ObjectFormat::Coff] {
            let mut command = Command::new("compiler");
            let scoped = scopes_math(&command);
            command.args(link_arguments(&flags, format, false, scoped));
            if format == ObjectFormat::Elf {
                command.args(["late.a", "-static"]);
                finish_elf_math(&mut command, scoped);
            }
            let actual: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            let expected = if format == ObjectFormat::Elf {
                [
                    "-lconstructor",
                    "uv.a",
                    "-ldl",
                    "-Wl,--exclude-libs,ALL",
                    "late.a",
                    "-static",
                    "-Wl,--push-state,--as-needed",
                    "-lm",
                    "-Wl,--pop-state",
                ]
                .map(str::to_owned)
                .to_vec()
            } else {
                flags.clone()
            };
            assert_eq!(actual, expected, "{format:?}");
        }
        let exported = link_arguments(&flags, ObjectFormat::Elf, true, true);
        assert!(!exported.contains(&"-Wl,--exclude-libs,ALL"));
        assert!(exported.contains(&"-lconstructor"));
    }

    #[test]
    fn static_and_zig_link_arguments_stay_unchanged() {
        let flags = ["-lconstructor", "uv.a", "-lm", "-ldl"]
            .map(str::to_owned)
            .to_vec();
        for (driver, prefix) in [("clang", "-static"), ("zig", "cc")] {
            let mut command = Command::new(driver);
            command.arg(prefix);
            let scoped = scopes_math(&command);
            assert!(!scoped, "{driver} {prefix}");
            command.args(link_arguments(&flags, ObjectFormat::Elf, false, scoped));
            finish_elf_math(&mut command, scoped);
            let actual: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            let expected: Vec<_> = std::iter::once(prefix.to_owned())
                .chain(flags.clone())
                .collect();
            assert_eq!(actual, expected, "{driver} {prefix}");
        }
    }
}
