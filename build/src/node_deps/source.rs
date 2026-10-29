use super::{PAYLOAD, SOURCE_BUNDLE, bundle, hash};
use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

pub(super) fn ensure(cache: &Path) -> Result<PathBuf> {
    let identity = serde_json::to_vec(&(SOURCE_BUNDLE, &bundle().versions))?;
    let directory = cache.join("sources").join(hash(&identity));
    std::fs::create_dir_all(&directory)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("entry.lock"))?;
    lock.lock()?;
    let stamp = directory.join("complete");
    if !stamp.is_file() {
        let bytes = miniz_oxide::inflate::decompress_to_vec_zlib(PAYLOAD)
            .map_err(|e| anyhow::anyhow!("embedded Node payload: {e:?}"))?;
        unpack(&bytes, &directory)?;
        std::fs::write(
            directory.join("nts_node_deps_versions.h"),
            version_header()?,
        )?;
        std::fs::write(&stamp, SOURCE_BUNDLE)?;
    }
    inventory(&directory)?;
    if std::fs::read(directory.join("nts_node_deps_versions.h"))? != version_header()?.as_bytes() {
        bail!("bundled Node version header changed");
    }
    for (name, expected) in &bundle().files {
        let path = directory.join(name);
        let content = std::fs::read(&path)
            .with_context(|| format!("reading bundled Node input {}", path.display()))?;
        if hash(&content) != *expected {
            bail!("bundled Node cache input changed: {}", path.display());
        }
    }
    Ok(directory)
}

fn version_header() -> Result<String> {
    let mut header = String::from(
        "/* Generated from the verified Node source recipe. */\n#ifndef NTS_NODE_DEPENDENCY_VERSIONS_H\n#define NTS_NODE_DEPENDENCY_VERSIONS_H\n",
    );
    for (name, version) in &bundle().versions {
        use std::fmt::Write as _;
        writeln!(
            header,
            "#define NTS_NODE_VERSION_{} {}",
            name.to_uppercase(),
            serde_json::to_string(version)?
        )
        .expect("writing version header");
    }
    header.push_str("#endif\n");
    Ok(header)
}

fn inventory(root: &Path) -> Result<()> {
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path
                .strip_prefix(root)?
                .to_str()
                .context("Node cache path")?;
            if entry.file_type()?.is_dir() {
                pending.push(path);
            } else if !bundle().files.contains_key(relative)
                && !["entry.lock", "complete", "nts_node_deps_versions.h"].contains(&relative)
            {
                bail!("unrecorded input in bundled Node source cache: {relative}");
            } else if entry.file_type()?.is_symlink() {
                bail!("symbolic link in bundled Node source cache: {relative}");
            }
        }
    }
    Ok(())
}

fn unpack(bytes: &[u8], directory: &Path) -> Result<()> {
    let mut input = Cursor::new(bytes);
    let mut count = 0;
    while input.position() < bytes.len() as u64 {
        let mut n = [0; 4];
        input.read_exact(&mut n)?;
        let mut name = vec![0; u32::from_le_bytes(n) as usize];
        input.read_exact(&mut name)?;
        let name = String::from_utf8(name)?;
        let mut size = [0; 8];
        input.read_exact(&mut size)?;
        let size = usize::try_from(u64::from_le_bytes(size))?;
        let at = usize::try_from(input.position())?;
        let content = bytes
            .get(at..at.checked_add(size).context("bundle size overflow")?)
            .context("incomplete bundle")?;
        let expected = bundle()
            .files
            .get(&name)
            .context("unexpected bundled path")?;
        if hash(content) != *expected {
            bail!("embedded Node source hash mismatch");
        }
        let path = directory.join(&name);
        std::fs::create_dir_all(path.parent().context("source parent")?)?;
        std::fs::write(&path, content)?;
        input.set_position(u64::try_from(at + size)?);
        count += 1;
    }
    if count != bundle().files.len() {
        bail!("incomplete Node source bundle");
    }
    Ok(())
}

pub(super) fn notices(source: &Path, names: &[String]) -> Result<BTreeMap<String, PathBuf>> {
    let directory = source
        .parent()
        .and_then(Path::parent)
        .context("dependency cache root")?
        .join("notices")
        .join(hash(&serde_json::to_vec(&bundle().notices)?));
    std::fs::create_dir_all(&directory)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("entry.lock"))?;
    lock.lock()?;
    let mut result = BTreeMap::new();
    for component in names {
        let text = bundle()
            .notices
            .get(component)
            .context("dependency notice")?;
        let path = directory.join(component);
        if std::fs::read(&path).ok().as_deref() != Some(text.as_bytes()) {
            let staged = directory.join(format!("{component}.next"));
            std::fs::write(&staged, text)?;
            std::fs::rename(staged, &path)?;
        }
        result.insert(format!("node-deps/{component}/LICENSE"), path);
    }
    Ok(result)
}
