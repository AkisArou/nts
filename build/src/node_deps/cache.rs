use super::{Request, Target, bundle, compile, hash, invocation};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::File,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Serialize, Deserialize)]
struct Entry {
    identity: String,
    archive: String,
    inputs: BTreeMap<String, String>,
    wall_seconds: f64,
    objects: usize,
}

pub(super) fn ensure(
    request: &Request,
    identity: &invocation::Context,
    source: &Path,
    target: &Target,
) -> Result<PathBuf> {
    let directory = request
        .cache
        .join("archives")
        .join(&identity.key)
        .join(&target.name);
    std::fs::create_dir_all(&directory)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("entry.lock"))?;
    lock.lock()?;
    std::fs::write(directory.join("invocation.json"), &identity.record)?;
    let archive = directory.join(format!("lib{}.a", target.name));
    let manifest = directory.join("complete.json");
    if valid(&manifest, &archive, &identity.key)? {
        return Ok(archive);
    }
    if manifest.exists() {
        std::fs::remove_file(&manifest)?;
    }
    let start = Instant::now();
    let objects = compile::objects(request, identity, source, target, &directory)?;
    let staged_archive = directory.join(format!("lib{}.next.a", target.name));
    if staged_archive.exists() {
        std::fs::remove_file(&staged_archive)?;
    }
    let output = identity
        .archiver()
        .arg("rcsD")
        .arg(&staged_archive)
        .args(&objects)
        .output()?;
    std::fs::write(directory.join("archive.stderr"), &output.stderr)?;
    if !output.status.success() {
        bail!(
            "archiving {} failed: {}",
            target.name,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let entry = Entry {
        identity: identity.key.clone(),
        archive: hash(&std::fs::read(&staged_archive)?),
        inputs: compile::observations(source, target, &directory)?,
        wall_seconds: start.elapsed().as_secs_f64(),
        objects: objects.len(),
    };
    let staged = directory.join("complete.next.json");
    std::fs::write(&staged, serde_json::to_vec_pretty(&entry)?)?;
    std::fs::rename(staged_archive, &archive)?;
    std::fs::rename(staged, &manifest)?;
    Ok(archive)
}

fn valid(manifest: &Path, archive: &Path, identity: &str) -> Result<bool> {
    if !manifest.is_file() || !archive.is_file() {
        return Ok(false);
    }
    let entry: Entry = serde_json::from_slice(&std::fs::read(manifest)?)?;
    if entry.identity != identity || hash(&std::fs::read(archive)?) != entry.archive {
        return Ok(false);
    }
    for (path, expected) in entry.inputs {
        if !std::fs::read(path).is_ok_and(|bytes| hash(&bytes) == expected) {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn source_hash(source: &Path, relative: &str) -> Result<String> {
    let expected = bundle()
        .files
        .get(relative)
        .context("unrecorded upstream source")?;
    let bytes = std::fs::read(source.join(relative))?;
    if hash(&bytes) != *expected {
        bail!("Node source changed: {relative}");
    }
    Ok(expected.clone())
}
