//! The code that produces snapshots, independent of core/backend rebuilds.

use std::io;
use std::path::Path;

pub(crate) const CRATES: &[(&str, &str)] = &[
    ("nts-diagnostics", "compiler/diagnostics"),
    ("nts-frontend-ts", "compiler/frontend-ts"),
    ("nts-semantic-schema", "compiler/semantic-schema"),
];

pub(crate) fn inputs(root: &Path) -> io::Result<Vec<(String, Vec<u8>)>> {
    fn visit(root: &Path, path: &Path, into: &mut Vec<(String, Vec<u8>)>) -> io::Result<()> {
        let meta = std::fs::symlink_metadata(path)?;
        if meta.is_symlink() {
            return Err(io::Error::other(format!(
                "stamp input is a symlink: {}",
                path.display()
            )));
        }
        if meta.is_dir() {
            for entry in std::fs::read_dir(path)? {
                visit(root, &entry?.path(), into)?;
            }
        } else if meta.is_file() {
            let relative = path.strip_prefix(root).map_err(io::Error::other)?;
            into.push((
                relative.to_string_lossy().replace('\\', "/"),
                std::fs::read(path)?,
            ));
        } else {
            return Err(io::Error::other("stamp input is not a regular file"));
        }
        Ok(())
    }
    let mut found = Vec::new();
    for file in ["Cargo.toml", "Cargo.lock"] {
        visit(root, &root.join(file), &mut found)?;
    }
    for &(_, dir) in CRATES {
        for name in ["Cargo.toml", "src"] {
            visit(root, &root.join(dir).join(name), &mut found)?;
        }
        for name in ["build.rs", "build_support.rs"] {
            let path = root.join(dir).join(name);
            if path.exists() {
                visit(root, &path, &mut found)?;
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(found)
}

pub(crate) fn stamp(inputs: &[(String, Vec<u8>)], cfg: &[(String, String)]) -> u128 {
    fn field(hash: &mut xxhash_rust::xxh3::Xxh3, bytes: &[u8]) {
        hash.update(
            &u64::try_from(bytes.len())
                .expect("input length fits u64")
                .to_le_bytes(),
        );
        hash.update(bytes);
    }
    let mut hash = xxhash_rust::xxh3::Xxh3::new();
    field(&mut hash, b"nts-frontend-stamp-v1");
    for (name, bytes) in inputs {
        field(&mut hash, name.as_bytes());
        field(&mut hash, bytes);
    }
    for (name, value) in cfg {
        field(&mut hash, name.as_bytes());
        field(&mut hash, value.as_bytes());
    }
    hash.digest128()
}
