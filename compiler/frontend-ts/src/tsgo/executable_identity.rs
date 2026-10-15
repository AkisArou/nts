//! Content identity of the executable actually selected, independent of its label.

use camino::{Utf8Path, Utf8PathBuf};

fn resolve(executable: &Utf8Path) -> Option<Utf8PathBuf> {
    let path = if executable.is_absolute() || executable.components().count() > 1 {
        executable.to_owned()
    } else {
        std::env::split_paths(&std::env::var_os("PATH")?).find_map(|dir| {
            let candidate = dir.join(executable);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let meta = std::fs::metadata(&candidate).ok()?;
                if !meta.is_file() || meta.permissions().mode() & 0o111 == 0 {
                    return None;
                }
            }
            candidate
                .is_file()
                .then(|| Utf8PathBuf::from_path_buf(candidate).ok())
                .flatten()
        })?
    };
    Utf8PathBuf::from_path_buf(std::fs::canonicalize(path).ok()?).ok()
}

fn metadata_key(path: &Utf8Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // ctime and inode catch an in-place rewrite with restored mtime, and
        // an atomic replacement whose size and mtime match the previous file.
        Some(format!(
            "{path}:{}:{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        ))
    }
    #[cfg(not(unix))]
    {
        None
    } // Without a reliable change identity, hash bytes afresh.
}

pub(super) fn fingerprint(executable: &Utf8Path) -> Option<u128> {
    let path = resolve(executable)?;
    let before = metadata_key(&path);
    let memo = before.as_ref().and_then(|key| {
        super::super::cache::cache_dir().map(|dir| {
            dir.join("compilers").join(format!(
                "{:032x}",
                xxhash_rust::xxh3::xxh3_128(key.as_bytes())
            ))
        })
    });
    if let Some(known) = &memo
        && let Ok(text) = std::fs::read_to_string(known)
        && let Ok(hash) = u128::from_str_radix(text.trim(), 16)
    {
        return (metadata_key(&path) == before).then_some(hash);
    }
    let bytes = std::fs::read(&path).ok()?;
    if metadata_key(&path) != before {
        return None;
    }
    let hash = xxhash_rust::xxh3::xxh3_128(&bytes);
    if let Some(path) = memo {
        let _ = super::super::cache::atomic_write(&path, format!("{hash:032x}\n").as_bytes());
    }
    Some(hash)
}
