//! Owned test artifacts, shared by integration tests without a product dependency.

use camino::{Utf8Path, Utf8PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// Keep this owner alive until the last compiler or tool has read its files.
/// Unwinding removes them too; `NTS_KEEP_TEST_SCRATCH=1` keeps and names them.
#[derive(Debug)]
#[must_use = "hold the scratch directory until its artifacts have been read"]
pub(crate) struct ScratchDir {
    path: Utf8PathBuf,
    keep: bool,
}

impl ScratchDir {
    pub(crate) fn new(parent: &Utf8Path, name: &str) -> Self {
        std::fs::create_dir_all(parent)
            .unwrap_or_else(|error| panic!("create test scratch parent {parent}: {error}"));
        let path = loop {
            let serial = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!("{}-{name}-{serial}", std::process::id()));
            match std::fs::create_dir(&path) {
                Ok(()) => break path,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("create test scratch {path}: {error}"),
            }
        };
        let keep = std::env::var_os("NTS_KEEP_TEST_SCRATCH").is_some_and(|value| value == "1");
        if keep {
            eprintln!("NTS_KEEP_TEST_SCRATCH=1: {path}");
        }
        Self { path, keep }
    }
}

impl std::ops::Deref for ScratchDir {
    type Target = Utf8Path;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
}

impl AsRef<std::path::Path> for ScratchDir {
    fn as_ref(&self) -> &std::path::Path {
        self.path.as_std_path()
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        if !self.keep
            && let Err(error) = std::fs::remove_dir_all(&self.path)
        {
            eprintln!("remove test scratch {}: {error}", self.path);
        }
    }
}
