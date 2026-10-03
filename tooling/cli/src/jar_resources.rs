//! Preserve ClassLoader resources when jar bytecode is converted to dex.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

pub(super) fn unpack_resources(
    jars: &[Utf8PathBuf],
    scratch: &Utf8Path,
    destination: &Utf8Path,
) -> Result<()> {
    std::fs::create_dir_all(destination).with_context(|| format!("creating {destination}"))?;
    for (index, jar) in jars.iter().enumerate() {
        let extracted = scratch.join(index.to_string());
        std::fs::create_dir_all(&extracted).with_context(|| format!("creating {extracted}"))?;
        let archive = super::absolute(jar);
        let mut unpack = std::process::Command::new("jar");
        unpack
            .arg("--extract")
            .arg("--file")
            .arg(archive.as_str())
            .current_dir(&extracted);
        super::run_tool(unpack, "jar", "extract dependency resources")?;
        let owner = format!("{index}-{}", jar.file_name().unwrap_or("dependency.jar"));
        merge_tree(&extracted, &extracted, destination, &owner)?;
    }
    Ok(())
}

fn signature(path: &Utf8Path) -> bool {
    if path.parent() != Some(Utf8Path::new("META-INF")) {
        return false;
    }
    let name = path.file_name().unwrap_or_default().to_ascii_uppercase();
    name == "MANIFEST.MF"
        || name.starts_with("SIG-")
        || [".SF", ".RSA", ".DSA", ".EC"]
            .iter()
            .any(|suffix| name.ends_with(suffix))
}

// Shading invalidates signatures, not services, licenses or library resources.
pub(super) fn remove_signatures(directory: &Utf8Path) -> Result<()> {
    if !directory.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(directory).with_context(|| format!("reading {directory}"))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_file() && signature(&Utf8Path::new("META-INF").join(name)) {
            std::fs::remove_file(entry.path()).context("removing an invalid jar signature")?;
        }
    }
    Ok(())
}

fn merge_tree(
    root: &Utf8Path,
    directory: &Utf8Path,
    destination: &Utf8Path,
    owner: &str,
) -> Result<()> {
    let mut entries = std::fs::read_dir(directory)
        .with_context(|| format!("reading {directory}"))?
        .map(|entry| {
            let path = entry?.path();
            Utf8PathBuf::from_path_buf(path)
                .map_err(|path| anyhow::anyhow!("non-UTF-8 jar path: {path:?}"))
        })
        .collect::<Result<Vec<_>>>()?;
    entries.sort();
    for path in entries {
        if path.is_dir() {
            merge_tree(root, &path, destination, owner)?;
            continue;
        }
        let relative = path.strip_prefix(root)?;
        if relative.extension() == Some("class") || signature(relative) {
            continue;
        }
        let name = relative
            .file_name()
            .unwrap_or_default()
            .to_ascii_uppercase();
        // Dependencies commonly use the same LICENSE/NOTICE path. Preserve
        // each notice under a deterministic owner rather than overwriting it.
        let legal = name.starts_with("LICENSE")
            || name.starts_with("NOTICE")
            || name.starts_with("COPYRIGHT");
        let target = if legal {
            destination
                .join("META-INF/nts/licenses")
                .join(owner)
                .join(relative)
        } else {
            destination.join(relative)
        };
        std::fs::create_dir_all(target.parent().unwrap())
            .with_context(|| format!("creating parents of {target}"))?;
        if !target.exists() {
            std::fs::copy(&path, &target).with_context(|| format!("copying {path} to {target}"))?;
        } else {
            let old = std::fs::read(&target)?;
            let new = std::fs::read(&path)?;
            if old == new {
                continue;
            }
            if relative.starts_with("META-INF/services") {
                // ServiceLoader ignores repeated providers and comments.
                let mut merged = old;
                merged.push(b'\n');
                merged.extend_from_slice(&new);
                std::fs::write(&target, merged)?;
            } else {
                bail!(
                    "conflicting dependency resource `{relative}` from `{owner}`; the APK cannot choose different library data silently"
                );
            }
        }
    }
    Ok(())
}
