//! The source/library boundary belongs to nts, not to the checker adapter.

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_tsrs::{File, Project};
use nts_semantic_schema::SnapshotError;
use rustc_hash::FxHashMap;

use crate::provided::SURFACES;

#[derive(Debug, Default)]
pub(crate) struct Inclusion {
    manifests: FxHashMap<Utf8PathBuf, bool>,
    /// Builder-owned inputs to retain beside the native host observations.
    pub read: Vec<Utf8PathBuf>,
}

impl Inclusion {
    pub(crate) fn files<'p>(
        &mut self,
        project: Project<'p>,
    ) -> Result<Vec<File<'p>>, SnapshotError> {
        let mut files = Vec::new();
        for file in project.files() {
            if file.is_default_library() {
                continue;
            }
            if file.is_external_library()
                && !(file.is_declaration() && self.surface(file.path())?)
            {
                continue;
            }
            files.push(file);
        }
        Ok(files)
    }

    fn surface(&mut self, file: &Utf8Path) -> Result<bool, SnapshotError> {
        for directory in file.ancestors().skip(1) {
            let manifest = directory.join("package.json");
            if let Some(&known) = self.manifests.get(&manifest) {
                return Ok(known);
            }
            match std::fs::metadata(&manifest) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(SnapshotError::Project(format!(
                        "cannot inspect {manifest}: {error}"
                    )));
                }
                Ok(metadata) if !metadata.is_file() => continue,
                Ok(_) => {}
            }
            let text = std::fs::read(&manifest).map_err(|error| {
                SnapshotError::Project(format!("cannot read {manifest}: {error}"))
            })?;
            let value: serde_json::Value = serde_json::from_slice(&text).map_err(|error| {
                SnapshotError::Project(format!("cannot parse {manifest}: {error}"))
            })?;
            let surface = match value.pointer("/nts/surface") {
                None => false,
                Some(serde_json::Value::String(name)) if SURFACES.contains(&name.as_str()) => true,
                Some(name) => {
                    return Err(SnapshotError::Project(format!(
                        "unknown nts surface {name} in {manifest}"
                    )));
                }
            };
            self.read.push(manifest.clone());
            self.manifests.insert(manifest, surface);
            return Ok(surface);
        }
        Ok(false)
    }
}
