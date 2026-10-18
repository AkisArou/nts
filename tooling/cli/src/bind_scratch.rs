//! A directory owned by one binder check, never shared by concurrent calls.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::{Context, Result};

static CALLS: AtomicUsize = AtomicUsize::new(0);

/// Labels describe the caller, not its module: sanitizing module names is
/// lossy. `create_dir` also avoids reusing a crashed process's directory after
/// the OS recycles its PID. Each caller removes only the directory it owns.
pub(crate) fn directory(label: &str) -> Result<PathBuf> {
    loop {
        let path = std::env::temp_dir().join(format!(
            "nts-{label}-{}-{}",
            std::process::id(),
            CALLS.fetch_add(1, Ordering::Relaxed)
        ));
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| format!("creating {}", path.display()));
            }
        }
    }
}
