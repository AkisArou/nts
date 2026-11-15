use super::{Request, Target, bundle, compile, hash, invocation};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Serialize, Deserialize)]
struct Entry {
    version: u32,
    identity: String,
    archive: String,
    inputs: Vec<compile::Observation>,
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
    if valid(&manifest, &archive, identity)? {
        return Ok(archive);
    }
    if manifest.exists() {
        std::fs::remove_file(&manifest)?;
    }
    let start = Instant::now();
    let objects = compile::objects(request, identity, source, target, &directory)?;
    let manifest_bytes = nts_publication::publish(&archive, |staged_archive| {
        let assemble = || -> Result<Vec<u8>> {
            let output = identity
                .archiver()
                .arg("rcsD")
                .arg(staged_archive)
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
                version: 2,
                identity: identity.key.clone(),
                archive: hash(&std::fs::read(staged_archive)?),
                inputs: compile::observations(&identity.source, source, target, &directory)?,
                wall_seconds: start.elapsed().as_secs_f64(),
                objects: objects.len(),
            };
            Ok(serde_json::to_vec_pretty(&entry)?)
        };
        assemble().map_err(std::io::Error::other)
    })?;
    nts_publication::write(&manifest, manifest_bytes)?;
    Ok(archive)
}

fn valid(manifest: &Path, archive: &Path, identity: &invocation::Context) -> Result<bool> {
    if !manifest.is_file() || !archive.is_file() {
        return Ok(false);
    }
    let entry: Entry = serde_json::from_slice(&std::fs::read(manifest)?)?;
    if entry.version != 2
        || entry.identity != identity.key
        || hash(&std::fs::read(archive)?) != entry.archive
    {
        return Ok(false);
    }
    for input in entry.inputs {
        let path = identity.source.resolve(&input.path)?;
        if !std::fs::read(path).is_ok_and(|bytes| hash(&bytes) == input.sha256) {
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
