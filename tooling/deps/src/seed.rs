//! Recovered sources can seed resolution; only the current program admits them.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};

use camino::{Utf8Path, Utf8PathBuf};

use crate::{Error, emit, manifest::Manifest, resolution};

type Observation = (Utf8PathBuf, String, Utf8PathBuf);

pub(super) struct Seed {
    pub known: BTreeSet<Observation>,
    directory: Option<Utf8PathBuf>,
}

impl Seed {
    pub(super) fn new(
        project: &Utf8Path,
        tsconfig: &Utf8Path,
        workspace: &Utf8Path,
    ) -> Result<Self, Error> {
        let lock = current_lock(workspace);
        let vendor = workspace.join(".nts/vendor");
        let mut known = BTreeSet::new();
        let mut paths = BTreeMap::new();
        for (name, package) in lock.packages {
            let source = Utf8PathBuf::from(package.source);
            for (specifier, target) in package.resolved {
                known.insert((source.clone(), specifier, Utf8PathBuf::from(target)));
            }
            let root = vendor.join(emit::package_dir(&format!("{name}@{}", package.version)));
            for (specifier, target) in package.mapped {
                let file = root.join(target);
                if file.is_file() {
                    paths.insert(specifier, vec![file.to_string()]);
                }
            }
        }
        let mut seed = Self {
            known,
            directory: None,
        };
        if paths.is_empty() {
            return Ok(seed);
        }
        // The seed changes lookup targets, never roots. Extending the user's
        // real config keeps its current include/files/references authoritative.
        // A private config also keeps --dry-run from touching the project.
        let directory = temporary_directory()?;
        seed.directory = Some(directory.clone());
        let inherited = crate::inherited_paths(tsconfig)
            .into_iter()
            .map(|(name, targets)| {
                let targets = targets
                    .into_iter()
                    .map(|target| project.join(target).to_string())
                    .collect();
                (name, targets)
            })
            .collect();
        emit::write_tsconfig(
            &directory,
            tsconfig.as_str(),
            workspace.as_str(),
            &paths,
            &inherited,
        )?;
        Ok(seed)
    }

    pub(super) fn config(&self) -> Option<Utf8PathBuf> {
        self.directory
            .as_ref()
            .map(|directory| directory.join("tsconfig.nts.json"))
    }
}

impl Drop for Seed {
    fn drop(&mut self) {
        if let Some(directory) = &self.directory
            && let Err(error) = std::fs::remove_dir_all(directory)
        {
            eprintln!("cannot remove dependency source seed {directory}: {error}");
        }
    }
}

/// A newly reached vendor entry retains its installed recovery provenance.
/// This never inserts a module: an actual root-reachable resolution is required.
pub(super) fn restore(resolution: &mut resolution::Resolution, workspace: &Utf8Path) {
    let lock = current_lock(workspace);
    let vendor = workspace.join(".nts/vendor");
    for module in &mut resolution.modules {
        for (name, package) in &lock.packages {
            let root = vendor.join(emit::package_dir(&format!("{name}@{}", package.version)));
            let Some(target) = package.mapped.get(&module.specifier) else {
                continue;
            };
            if module.file != root.join(target) {
                continue;
            }
            let Some(original) = package.resolved.get(&module.specifier) else {
                continue;
            };
            module.file = Utf8PathBuf::from(original);
            module.package = Some(resolution::PackageRef {
                name: name.clone(),
                version: package.version.clone(),
                dir: Utf8PathBuf::from(&package.source),
            });
            break;
        }
    }
}

fn current_lock(workspace: &Utf8Path) -> emit::Lock {
    let mut lock = emit::read_lock(workspace);
    lock.packages.retain(|_, package| {
        Manifest::read(&Utf8Path::new(&package.source).join("package.json"))
            .is_ok_and(|manifest| manifest.version == package.version)
    });
    lock
}

fn temporary_directory() -> Result<Utf8PathBuf, Error> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .map_err(|path| Error::SeedPath(path.display().to_string()))?;
    loop {
        let serial = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!("nts-deps-seed-{}-{serial}", std::process::id()));
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(source) => return Err(emit::EmitError::Write { path, source }.into()),
        }
    }
}
