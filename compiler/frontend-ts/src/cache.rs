//! A snapshot remembered on disk, so a project nobody has touched is not asked
//! about twice.
//!
//! # What it is for
//!
//! Asking tsgo costs about 170ms for a small project, which is roughly a
//! quarter of a whole `nts check` — and the gate asks the same question about
//! the same 89 examples twice over, once for the differential and once again
//! under reference counting, on byte-identical input. That second pass learns
//! nothing.
//!
//! # Why not `SemanticSnapshot::digest`
//!
//! Because it hashes the snapshot, which is the answer. A cache key has to be
//! made of the *question*: the files, the tool and the schema.
//!
//! # What makes an entry valid
//!
//! Three things, and the third is the one that is easy to forget:
//!
//! - every file the snapshot says it read still hashes the same. The snapshot
//!   records them, which is what makes an import outside the project directory
//!   -- and the node profile is full of them -- part of the key rather than a
//!   hole in it;
//! - the tool and the schema version are the ones that produced it;
//! - the *set* of `.ts` files under the project has not changed. A file added
//!   beside the others is picked up by a `tsconfig` glob without any existing
//!   file changing a byte, so content hashes alone would not see it.
//!
//! A miss costs a read and a few hashes. A wrong hit would cost a green gate on
//! code that no longer exists, so the checks lean that way.

use camino::{Utf8Path, Utf8PathBuf};
use nts_semantic_schema::{SCHEMA_VERSION, SemanticSnapshot, SnapshotError};
use serde::{Deserialize, Serialize};

use crate::source::SemanticSource;

/// What was true when the snapshot was taken.
#[derive(Serialize, Deserialize)]
struct Entry {
    schema: u32,
    tool: String,
    /// Every file the snapshot read, and what its bytes hashed to.
    read: Vec<(String, u128)>,
    /// The `.ts` files under the project, so an addition is not invisible.
    listing: Vec<String>,
    snapshot: SemanticSnapshot,
}

/// Take a snapshot, reusing a stored one where nothing has changed.
///
/// Falls back to asking `source` for anything it cannot prove: an unreadable
/// cache, an entry from another tool, a file it cannot hash.
///
/// # Errors
///
/// Whatever `source` returns when the snapshot has to be taken.
pub fn snapshot<S: SemanticSource>(
    source: &mut S,
    tsconfig: &Utf8Path,
    tool: &str,
) -> Result<SemanticSnapshot, SnapshotError> {
    let Some(dir) = cache_dir() else {
        return source.snapshot(tsconfig);
    };
    let listing = project_listing(tsconfig);
    let path = dir.join(format!("{:032x}.postcard", hash_of(tsconfig.as_str().as_bytes())));

    if let Some(entry) = read_entry(&path)
        && entry.schema == SCHEMA_VERSION
        && entry.tool == tool
        && entry.listing == listing
        && entry.read.iter().all(|(file, seen)| {
            std::fs::read(file).is_ok_and(|bytes| hash_of(&bytes) == *seen)
        })
    {
        return Ok(entry.snapshot);
    }

    let snapshot = source.snapshot(tsconfig)?;
    let read: Vec<(String, u128)> = snapshot
        .sources
        .iter()
        .filter_map(|file| {
            let bytes = std::fs::read(&file.display_path).ok()?;
            Some((file.display_path.as_str().to_owned(), hash_of(&bytes)))
        })
        .collect();
    // Only when every file it read could be hashed. One that could not is a
    // dependency the entry would not be able to check, and an entry that cannot
    // check itself is worse than no entry.
    if read.len() == snapshot.sources.len() {
        let entry = Entry {
            schema: SCHEMA_VERSION,
            tool: tool.to_owned(),
            read,
            listing,
            snapshot: snapshot.clone(),
        };
        if let Ok(bytes) = postcard::to_allocvec(&entry) {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&path, bytes);
        }
    }
    Ok(snapshot)
}

/// Where entries live, or `None` when the cache is switched off.
///
/// `NTS_NO_SNAPSHOT_CACHE=1` turns it off, which is what to reach for when a
/// stale entry is ever suspected: the answer should not change.
fn cache_dir() -> Option<Utf8PathBuf> {
    if std::env::var("NTS_NO_SNAPSHOT_CACHE").is_ok_and(|value| value != "0") {
        return None;
    }
    if let Ok(named) = std::env::var("NTS_SNAPSHOT_CACHE") {
        return Some(Utf8PathBuf::from(named));
    }
    Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .ok()
        .map(|dir| dir.join("nts-snapshots"))
}

fn hash_of(bytes: &[u8]) -> u128 {
    xxhash_rust::xxh3::xxh3_128(bytes)
}

/// Every `.ts` under the project directory, sorted.
///
/// Names only: what the bytes say is already covered by `read` above, and this
/// is here for the file that appears without anything else changing.
fn project_listing(tsconfig: &Utf8Path) -> Vec<String> {
    let Some(root) = tsconfig.parent() else {
        return Vec::new();
    };
    let mut found = Vec::new();
    walk(root, &mut found, 0);
    found.sort_unstable();
    found
}

fn walk(dir: &Utf8Path, into: &mut Vec<String>, depth: u32) {
    // A project is a handful of directories deep. The bound is a guard against
    // a symlink loop rather than a limit anyone should reach.
    if depth > 16 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
            continue;
        };
        if path.is_dir() {
            walk(&path, into, depth + 1);
        } else if path.extension() == Some("ts") || path.extension() == Some("tsx") {
            into.push(path.into_string());
        }
    }
}

fn read_entry(path: &Utf8Path) -> Option<Entry> {
    let bytes = std::fs::read(path).ok()?;
    postcard::from_bytes(&bytes).ok()
}
