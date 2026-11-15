//! Atomic visibility of files, links and immutable directories.
//!
//! Each producer owns an exclusively acquired sibling directory. Its payload
//! initially does not exist. Neither collision handling nor cleanup removes
//! another producer's namespace. This provides atomic visibility, not fsync
//! durability. A host refusing rename-over-existing is reported without a
//! remove-and-retry fallback, including on Windows.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const PRIVATE: &str = ".nts-publication-";
static SERIAL: AtomicU64 = AtomicU64::new(0);

fn claim_name(serial: u64) -> String {
    format!("{PRIVATE}{}-{serial}", std::process::id())
}

/// The primary operation, cleanup and any retained recovery path stay together.
#[derive(Debug)]
pub struct Error {
    operation: &'static str,
    target: PathBuf,
    primary: io::Error,
    cleanup: Option<io::Error>,
    recovery: Option<PathBuf>,
}

impl std::fmt::Display for Error {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            out,
            "atomic publication {} {}: {}",
            self.operation,
            self.target.display(),
            self.primary
        )?;
        if let Some(cleanup) = &self.cleanup {
            write!(out, "; cleanup/restore: {cleanup}")?;
        }
        if let Some(path) = &self.recovery {
            write!(out, "; retained recovery path {}", path.display())?;
        }
        Ok(())
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.primary)
    }
}

type Result<T> = std::result::Result<T, Error>;

fn failure(operation: &'static str, target: &Path, primary: io::Error) -> Error {
    Error {
        operation,
        target: target.to_owned(),
        primary,
        cleanup: None,
        recovery: None,
    }
}

fn parent(target: &Path) -> io::Result<&Path> {
    if target.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "publication target has no file name",
        ));
    }
    Ok(target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new(".")))
}

/// Private namespace names are never committed cache entries or prune targets.
#[must_use]
pub fn private_name(name: &std::ffi::OsStr) -> bool {
    name.as_encoded_bytes().starts_with(PRIVATE.as_bytes())
}

/// A portable stable lock. Its file is deliberately retained: unlinking a lock
/// lets another opener lock a different inode while this lock is still held.
#[derive(Debug)]
#[must_use = "hold the lock through validation, publication and pruning"]
pub struct Lock {
    _file: File,
}

/// Lock the identity of a target (which need not exist). Different spellings
/// of the same parent and basename reach the same lock. A hash collision only
/// serializes unrelated targets; it grants no identity or publication facts.
pub fn lock(target: &Path) -> Result<Lock> {
    let open = || -> io::Result<File> {
        let directory = parent(target)?;
        fs::create_dir_all(directory)?;
        let key = target
            .file_name()
            .ok_or_else(|| io::Error::other("missing target name"))?
            .as_encoded_bytes()
            .iter()
            .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
                (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
            });
        let file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join(format!("{PRIVATE}lock-{key:016x}")))?;
        file.lock()?;
        Ok(file)
    };
    open()
        .map(|file| Lock { _file: file })
        .map_err(|error| failure("locking", target, error))
}

#[derive(Debug)]
struct Staged {
    target: PathBuf,
    claim: PathBuf,
    payload: PathBuf,
    owned: bool,
}

impl Staged {
    fn new(target: &Path) -> Result<Self> {
        Self::acquire(target, || {
            SERIAL
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |serial| {
                    serial.checked_add(1)
                })
                .map_err(|_| io::Error::other("publication serial exhausted"))
        })
    }

    fn acquire(target: &Path, mut next: impl FnMut() -> io::Result<u64>) -> Result<Self> {
        let mut acquire = || -> io::Result<PathBuf> {
            let directory = parent(target)?;
            fs::create_dir_all(directory)?;
            loop {
                let claim = directory.join(claim_name(next()?));
                match fs::create_dir(&claim) {
                    Ok(()) => return Ok(claim),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error),
                }
            }
        };
        let claim = acquire().map_err(|error| failure("acquiring staging for", target, error))?;
        Ok(Self {
            target: target.to_owned(),
            payload: claim.join("payload"),
            claim,
            owned: true,
        })
    }

    fn finish<T>(mut self, result: io::Result<T>, operation: &'static str) -> Result<T> {
        self.owned = false;
        let cleanup = fs::remove_dir_all(&self.claim).err();
        match (result, cleanup) {
            (Ok(value), None) => Ok(value),
            (Ok(_), Some(error)) => Err(Error {
                recovery: Some(self.claim.clone()),
                ..failure("cleaning staging for", &self.target, error)
            }),
            (Err(error), cleanup) => Err(Error {
                recovery: cleanup.as_ref().map(|_| self.claim.clone()),
                cleanup,
                ..failure(operation, &self.target, error)
            }),
        }
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        // The checked finish handles ordinary errors. Unwinding can only clean
        // our own exclusively acquired claim, never a colliding namespace.
        if self.owned
            && let Err(error) = fs::remove_dir_all(&self.claim)
        {
            eprintln!(
                "atomic publication cleanup {}: {error}",
                self.claim.display()
            );
        }
    }
}

/// Produce a file or symlink at an initially absent private path, then publish
/// it with one rename. A failed rename retains the prior target and is named;
/// there is no destructive fallback when the host cannot replace it atomically.
pub fn publish<T>(target: &Path, produce: impl FnOnce(&Path) -> io::Result<T>) -> Result<T> {
    let staged = Staged::new(target)?;
    let result = produce(&staged.payload).and_then(|value| {
        let kind = fs::symlink_metadata(&staged.payload)?.file_type();
        if !kind.is_file() && !kind.is_symlink() {
            return Err(io::Error::other("file publication requires a regular file or symlink; directories use the locked directory owner"));
        }
        fs::rename(&staged.payload, target)?;
        Ok(value)
    });
    staged.finish(result, "producing/renaming")
}

/// Write bytes through the same external-producer publication lifetime.
pub fn write(target: &Path, bytes: impl AsRef<[u8]>) -> Result<()> {
    publish(target, |path| fs::write(path, bytes))
}

/// A complete existing immutable target is reused rather than overwritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryPublication {
    Published,
    Reused,
}

/// Stage a complete directory, then validate/reuse or replace under the target
/// lock. Invalid old contents remain in our quarantine until publish succeeds.
pub fn directory(
    target: &Path,
    produce: impl FnOnce(&Path) -> io::Result<()>,
    valid: impl Fn(&Path) -> io::Result<bool>,
) -> Result<DirectoryPublication> {
    let staged = Staged::new(target)?;
    if let Err(error) = produce(&staged.payload) {
        return staged.finish(Err(error), "producing directory for");
    }
    commit_directory(staged, valid, |from, to| fs::rename(from, to))
}

enum PreparedDirectory {
    Reuse,
    Fresh,
    Replace,
}
enum Payload {
    File,
    Directory,
}

/// Convert an owned legacy directory to a file/link without an unlocked
/// remove-before-write race. Existing files/links still use one rename;
/// directories use the same locked quarantine and restore as directory commit.
pub fn publish_over_directory(
    target: &Path,
    produce: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<()> {
    let staged = Staged::new(target)?;
    if let Err(error) = produce(&staged.payload) {
        return staged.finish(Err(error), "producing replacement for");
    }
    commit_target(
        staged,
        Payload::File,
        |_| Ok(false),
        |from, to| fs::rename(from, to),
    )
    .map(|_| ())
}

fn commit_directory(
    staged: Staged,
    valid: impl Fn(&Path) -> io::Result<bool>,
    rename: impl Fn(&Path, &Path) -> io::Result<()>,
) -> Result<DirectoryPublication> {
    commit_target(staged, Payload::Directory, valid, rename)
}

fn commit_target(
    mut staged: Staged,
    payload: Payload,
    valid: impl Fn(&Path) -> io::Result<bool>,
    rename: impl Fn(&Path, &Path) -> io::Result<()>,
) -> Result<DirectoryPublication> {
    let held = match lock(&staged.target) {
        Ok(held) => held,
        Err(error) => return staged.finish(Err(io::Error::other(error)), "locking directory for"),
    };
    let previous = staged.claim.join("previous");
    let prepare = || -> io::Result<PreparedDirectory> {
        let kind = fs::symlink_metadata(&staged.payload)?.file_type();
        match payload {
            Payload::Directory if !kind.is_dir() || !valid(&staged.payload)? => {
                return Err(io::Error::other("staged directory is incomplete"));
            }
            Payload::File if !kind.is_file() && !kind.is_symlink() => {
                return Err(io::Error::other(
                    "staged replacement is not a file or symlink",
                ));
            }
            _ => {}
        }
        match fs::symlink_metadata(&staged.target) {
            Ok(metadata) if matches!(payload, Payload::File) && !metadata.is_dir() => {
                Ok(PreparedDirectory::Fresh)
            }
            Ok(metadata) if metadata.is_dir() && valid(&staged.target)? => {
                Ok(PreparedDirectory::Reuse)
            }
            Ok(_) => {
                rename(&staged.target, &previous)?;
                Ok(PreparedDirectory::Replace)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(PreparedDirectory::Fresh),
            Err(error) => Err(error),
        }
    };
    let result = match prepare() {
        Ok(PreparedDirectory::Reuse) => Ok(DirectoryPublication::Reused),
        Ok(prepared) => match rename(&staged.payload, &staged.target) {
            Ok(()) => Ok(DirectoryPublication::Published),
            Err(primary) => {
                if matches!(prepared, PreparedDirectory::Replace)
                    && let Err(cleanup) = rename(&previous, &staged.target)
                {
                    staged.owned = false;
                    return Err(Error {
                        operation: "publishing directory",
                        target: staged.target.clone(),
                        primary,
                        cleanup: Some(cleanup),
                        recovery: Some(previous),
                    });
                }
                Err(primary)
            }
        },
        Err(error) => Err(error),
    };
    let result = staged.finish(result, "publishing directory");
    drop(held);
    result
}

#[cfg(test)]
#[path = "../../../compiler/test-support/scratch.rs"]
mod scratch;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_exclusive_claim_collision_is_retried_without_touching_the_other_writer() {
        let root = scratch::StdScratchDir::in_std_target("publication-collision");
        let foreign = root.join(claim_name(9));
        fs::create_dir(&foreign).expect("foreign claim");
        fs::write(foreign.join("sentinel"), "foreign").expect("foreign sentinel");
        let mut serials = [9, 10].into_iter();
        let staged = Staged::acquire(&root.join("target"), || {
            Ok(serials.next().expect("collision retried once"))
        })
        .expect("own claim");
        let own = staged.claim.clone();
        assert_ne!(own, foreign);
        drop(staged);
        assert!(!own.exists());
        assert_eq!(
            fs::read_to_string(foreign.join("sentinel")).expect("foreign remains"),
            "foreign"
        );
    }

    fn replacement(root: &Path) -> Staged {
        let target = root.join("target");
        fs::create_dir(&target).expect("old directory");
        fs::write(target.join("old"), "old").expect("old bytes");
        let staged = Staged::new(&target).expect("staging");
        fs::create_dir(&staged.payload).expect("new directory");
        fs::write(staged.payload.join("complete"), "new").expect("new bytes");
        staged
    }

    #[test]
    fn a_refused_publish_restores_the_actual_quarantined_directory() {
        let root = scratch::StdScratchDir::in_std_target("publication-rollback");
        let staged = replacement(&root);
        let payload = staged.payload.clone();
        let error = commit_directory(
            staged,
            |path| Ok(path.join("complete").is_file()),
            |from, to| {
                if from == payload {
                    Err(io::Error::other("supplied publish refusal"))
                } else {
                    fs::rename(from, to)
                }
            },
        )
        .expect_err("publish refused");
        assert!(error.to_string().contains("supplied publish refusal"));
        assert_eq!(
            fs::read_to_string(root.join("target/old")).expect("restored bytes"),
            "old"
        );
    }

    #[test]
    fn a_refused_restore_names_and_preserves_the_recovery_directory() {
        let root = scratch::StdScratchDir::in_std_target("publication-recovery");
        let staged = replacement(&root);
        let payload = staged.payload.clone();
        let error = commit_directory(
            staged,
            |path| Ok(path.join("complete").is_file()),
            |from, to| {
                if from == payload {
                    Err(io::Error::other("supplied publish refusal"))
                } else if from.file_name().is_some_and(|name| name == "previous") {
                    Err(io::Error::other("supplied restore refusal"))
                } else {
                    fs::rename(from, to)
                }
            },
        )
        .expect_err("publish and restore refused");
        let message = error.to_string();
        assert!(
            message.contains("supplied publish refusal")
                && message.contains("supplied restore refusal")
                && message.contains("retained recovery path")
        );
        assert_eq!(
            fs::read_to_string(error.recovery.expect("recovery path").join("old"))
                .expect("retained old bytes"),
            "old"
        );
    }
}
