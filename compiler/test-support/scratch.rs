//! Owned test artifacts, shared by integration tests without a product dependency.

use camino::{Utf8Path, Utf8PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// Keep this owner alive until the last compiler or tool has read its files.
/// Unwinding removes them too; `NTS_KEEP_TEST_SCRATCH=1` keeps and names them.
#[derive(Debug)]
#[must_use = "hold the scratch directory until its artifacts have been read"]
pub(crate) struct ScratchDir<P: AsRef<std::path::Path> = Utf8PathBuf> {
    path: P,
    root: Utf8PathBuf,
    keep: bool,
}

impl ScratchDir {
    /// Plain cargo tests fall back to the compile-time target directory.
    #[allow(dead_code)] // Included by tests that use custom parents too.
    pub(crate) fn in_target(name: &str) -> Self {
        Self::new(&target_parent(), name)
    }

    pub(crate) fn new(parent: &Utf8Path, name: &str) -> Self {
        Self::create(parent, name, std::convert::identity)
    }
}

#[allow(dead_code)]
fn target_parent() -> Utf8PathBuf {
    std::env::var("NTS_TEST_SCRATCH_ROOT").map_or_else(
        |_| match option_env!("CARGO_TARGET_TMPDIR") {
            Some(parent) => parent.into(),
            None => panic!("integration test scratch directory"),
        },
        Utf8PathBuf::from,
    )
}

/// The same owner for tests that use standard-library paths.
#[allow(dead_code)]
pub(crate) type StdScratchDir = ScratchDir<std::path::PathBuf>;

impl StdScratchDir {
    #[allow(dead_code)]
    pub(crate) fn in_std_target(name: &str) -> Self {
        Self::create(&target_parent(), name, Utf8PathBuf::into_std_path_buf)
    }
}

impl<P: AsRef<std::path::Path>> ScratchDir<P> {
    fn create(parent: &Utf8Path, name: &str, convert: fn(Utf8PathBuf) -> P) -> Self {
        assert!(
            !name.is_empty()
                && std::path::Path::new(name)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_))),
            "test scratch name must be a relative path: {name}"
        );
        let label: String = name
            .chars()
            .take(80)
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        std::fs::create_dir_all(parent)
            .unwrap_or_else(|error| panic!("create test scratch parent {parent}: {error}"));
        let root = loop {
            let serial = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!("{}-{label}-{serial}", std::process::id()));
            match std::fs::create_dir(&path) {
                Ok(()) => break path,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("create test scratch {path}: {error}"),
            }
        };
        let keep = std::env::var_os("NTS_KEEP_TEST_SCRATCH").is_some_and(|value| value == "1");
        if keep {
            eprintln!("NTS_KEEP_TEST_SCRATCH=1: {root}");
        }
        let owner = Self {
            path: convert(root.join(name)),
            root,
            keep,
        };
        std::fs::create_dir_all(owner.path.as_ref()).unwrap_or_else(|error| {
            panic!(
                "create test scratch path {}: {error}",
                owner.path.as_ref().display()
            )
        });
        owner
    }
}

impl<P: AsRef<std::path::Path> + std::ops::Deref> std::ops::Deref for ScratchDir<P> {
    type Target = P::Target;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
}

impl<P: AsRef<std::path::Path>> AsRef<std::path::Path> for ScratchDir<P> {
    fn as_ref(&self) -> &std::path::Path {
        self.path.as_ref()
    }
}

impl<P: AsRef<std::path::Path>> AsRef<std::ffi::OsStr> for ScratchDir<P> {
    fn as_ref(&self) -> &std::ffi::OsStr {
        self.path.as_ref().as_os_str()
    }
}

impl AsRef<Utf8Path> for ScratchDir {
    fn as_ref(&self) -> &Utf8Path {
        &self.path
    }
}

impl<P: AsRef<std::path::Path>> Drop for ScratchDir<P> {
    fn drop(&mut self) {
        if !self.keep
            && let Err(error) = std::fs::remove_dir_all(&self.root)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("remove test scratch {}: {error}", self.root);
            // Preserve the original panic during unwinding. The checked runner
            // reports and removes the leftover in either case.
            assert!(std::thread::panicking(), "test scratch cleanup failed");
        }
    }
}
