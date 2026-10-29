//! Search directory names are inputs too: a new earlier header can shadow one.
use super::{hash, invocation};
use anyhow::{Context as _, Result, bail};
use std::{collections::BTreeSet, path::PathBuf, process::Stdio};

pub(super) fn fingerprint(context: &invocation::Context) -> Result<String> {
    let output = context
        .compiler()
        .args(&context.flags)
        .args(["-E", "-x", "c", "-v", "-"])
        .stdin(Stdio::null())
        .output()?;
    if !output.status.success() {
        bail!(
            "cannot observe compiler include search: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let text = String::from_utf8(output.stderr)?;
    let mut roots = Vec::new();
    let mut inside = false;
    let mut found = false;
    let mut configs = Vec::new();
    for line in text.lines() {
        if let Some(path) = line.trim().strip_prefix("Configuration file: ") {
            let bytes = std::fs::read(path)?;
            invocation::config_options(&bytes)?;
            configs.push((path.to_owned(), hash(&bytes)));
        }
        if line.contains("search starts here:") {
            inside = true;
            found = true;
            continue;
        }
        if line.trim() == "End of search list." {
            inside = false;
            continue;
        }
        if inside {
            roots.push(PathBuf::from(line.trim()));
        }
        if let Some(path) = line
            .trim()
            .strip_prefix("ignoring nonexistent directory \"")
            .and_then(|s| s.strip_suffix('"'))
        {
            roots.push(PathBuf::from(path));
        }
    }
    if !found {
        bail!("compiler did not report its include search");
    }
    // Forced headers can themselves contain local quoted includes.
    for line in String::from_utf8(output.stdout)?.lines() {
        if let Some(path) = line
            .strip_prefix("# ")
            .and_then(|s| s.split_once('"'))
            .and_then(|(_, s)| s.split_once('"'))
            .map(|(s, _)| s)
            && !path.starts_with('<')
            && let Some(parent) = std::path::Path::new(path).parent()
        {
            roots.push(parent.to_owned());
        }
    }
    Ok(hash(&serde_json::to_vec(&(directories(roots)?, configs))?))
}

pub(super) fn directories(mut pending: Vec<PathBuf>) -> Result<String> {
    let mut visited = BTreeSet::new();
    let mut records = Vec::new();
    let mut budget = 1_000_000usize;
    while let Some(path) = pending.pop() {
        if budget == 0 {
            bail!("compiler search inventory exceeds its entry bound");
        }
        budget -= 1;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                records.push((path, "missing".to_owned()));
                continue;
            }
            Err(error) => {
                return Err(error).with_context(|| format!("observing {}", path.display()));
            }
        };
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::MetadataExt as _;
            metadata.mode()
        };
        #[cfg(not(unix))]
        let mode = u32::from(metadata.permissions().readonly());
        if metadata.is_symlink() {
            let target = std::fs::read_link(&path)?;
            records.push((path.clone(), format!("link:{}", target.display())));
            match path.canonicalize() {
                Ok(resolved) => pending.push(resolved),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    records.push((path, "missing link target".to_owned()));
                }
                Err(error) => return Err(error).context("resolving compiler search link"),
            }
        } else if metadata.is_dir() {
            let actual = path.canonicalize()?;
            if !visited.insert(actual) {
                continue;
            }
            records.push((path.clone(), format!("directory:{mode}")));
            let mut entries = std::fs::read_dir(&path)?
                .map(|entry| entry.map(|e| e.path()))
                .collect::<std::io::Result<Vec<_>>>()?;
            entries.sort();
            pending.extend(entries);
        } else {
            records.push((path, format!("file:{mode}")));
        }
    }
    records.sort();
    Ok(hash(&serde_json::to_vec(&records)?))
}

#[cfg(all(test, unix))]
mod tests {
    use super::directories;
    use std::os::unix::fs::{PermissionsExt as _, symlink};

    #[test]
    fn search_inventory_observes_shadowing_and_missing_link_targets() {
        let root = std::env::temp_dir().join(format!("nts-header-search-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("search fixture");
        let target = root.join("later.h");
        symlink(&target, root.join("alias.h")).expect("absent header link");
        let before = directories(vec![root.clone()]).expect("absent target");
        std::fs::write(&target, "#define PRESENT 1\n").expect("new header");
        let after = directories(vec![root.clone()]).expect("new target");
        assert_ne!(before, after);
        assert_eq!(
            after,
            directories(vec![root.clone()]).expect("stable inventory")
        );
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))
            .expect("mode change");
        assert_ne!(
            after,
            directories(vec![root.clone()]).expect("changed visibility")
        );
        std::fs::remove_dir_all(root).expect("fixture cleanup");
    }
}
