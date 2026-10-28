//! The source/library boundary belongs to nts, not to the checker adapter.

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_tsrs::{File, Project};
use nts_semantic_schema::SnapshotError;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::provided::SURFACES;

#[derive(Debug, Default)]
pub(crate) struct Inclusion {
    manifests: FxHashMap<Utf8PathBuf, bool>,
    /// Exact implementation closure supplied by the selected, validated plan.
    /// Naming one package entry never admits other external source files.
    planned: FxHashSet<Utf8PathBuf>,
    existing: FxHashSet<Utf8PathBuf>,
    /// Builder-owned inputs to retain beside the native host observations.
    pub read: Vec<Utf8PathBuf>,
}

impl Inclusion {
    pub(crate) fn allow_sources(&mut self, paths: &[Utf8PathBuf], existing: Vec<Utf8PathBuf>) {
        self.planned.extend(paths.iter().cloned());
        self.existing.extend(existing);
    }

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
                && !self.planned.contains(file.path())
                && !(file.is_declaration() && self.surface(file.path())?)
            {
                continue;
            }
            files.push(file);
        }
        if !self.planned.is_empty() {
            let included: FxHashSet<_> = files.iter().map(|file| file.path()).collect();
            for path in &self.planned {
                if !included.contains(path.as_path()) {
                    return Err(SnapshotError::Project(format!(
                        "planned implementation source was not loaded: {path}"
                    )));
                }
            }
            let excluded: FxHashSet<_> = project
                .files()
                .filter(|file| {
                    !file.is_declaration()
                        && !self.planned.contains(file.path())
                        && !self.existing.contains(file.path())
                })
                .map(File::path)
                .collect();
            for file in &files {
                if !self.planned.contains(file.path()) {
                    continue;
                }
                for imported in file.resolved_imports() {
                    if let Some(path) = imported
                        .resolved_path
                        .filter(|path| excluded.contains(path))
                    {
                        return Err(SnapshotError::Project(format!(
                            "planned source {} imports {path} outside its recorded implementation closure",
                            file.path(),
                        )));
                    }
                }
            }
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
