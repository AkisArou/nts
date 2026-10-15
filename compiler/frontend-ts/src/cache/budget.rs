//! Cross-process publication budget. Readers never acquire this lock.
//!
//! The ledger bounds serialized snapshots and dependency hints, including
//! abandoned payload partials. It is O(1) on ordinary publication; directory
//! scans happen on reconciliation, hourly age collection, or a low-water sweep.
//! The stable lock lives outside the payload pool so eviction cannot unlink it.

use std::fs::{File, Metadata};
use std::io;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use super::{atomic_write, read_value};

/// Payloads are flat: `entry_path` writes in the cache root and hints write
/// only in `manifests`. These are also exactly the directories Pool inventories.
/// Moving either namespace into subdirectories must update both together.
#[derive(Default, PartialEq, Eq, Serialize, Deserialize)]
struct Directories {
    root: Option<u128>,
    hints: Option<u128>,
}

impl Directories {
    fn read(dir: &Utf8Path) -> Self {
        let stamp = |path: &Utf8Path| {
            std::fs::metadata(path)
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|d| d.as_nanos())
        };
        Self {
            root: stamp(dir),
            hints: stamp(&dir.join("manifests")),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Ledger {
    format: u32,
    used: u64,
    hour: Option<u64>,
    dirty: bool,
    directories: Directories,
}

struct Budget {
    // Closing the file releases the OS lock, including after a process crash.
    _lock: File,
    state_path: Utf8PathBuf,
    ledger: Ledger,
}

impl Budget {
    fn acquire(dir: &Utf8Path) -> io::Result<Self> {
        std::fs::create_dir_all(dir.join(".budget"))?;
        std::fs::create_dir_all(dir.join("manifests"))?;
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join(".budget/lock"))?;
        lock.lock()?;
        let state_path = dir.join(".budget/state");
        let mut ledger = read_value::<Ledger>(&state_path)
            .filter(|s| s.format == 1)
            .unwrap_or_default();
        let directories = Directories::read(dir);
        if ledger.format != 1 || ledger.dirty || ledger.directories != directories {
            ledger.used = Pool::read(dir)?.total;
        }
        ledger.format = 1;
        ledger.directories = directories;
        ledger.dirty = true;
        // If publication or eviction is interrupted, the next writer must
        // recount actual files before it can trust an O(1) increment again.
        atomic_write(
            &state_path,
            &postcard::to_allocvec(&ledger).map_err(io::Error::other)?,
        )?;
        Ok(Self {
            _lock: lock,
            state_path,
            ledger,
        })
    }

    fn finish(mut self, dir: &Utf8Path) -> io::Result<()> {
        self.ledger.directories = Directories::read(dir);
        self.ledger.dirty = false;
        atomic_write(
            &self.state_path,
            &postcard::to_allocvec(&self.ledger).map_err(io::Error::other)?,
        )
    }

    fn collect_age(&mut self, dir: &Utf8Path, now: SystemTime) -> io::Result<()> {
        let hour = now
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_secs()
            / 3600;
        if self.ledger.hour != Some(hour) {
            let mut pool = Pool::read(dir)?;
            pool.remove_old(now)?;
            self.ledger.used = pool.total;
            self.ledger.hour = Some(hour);
        }
        Ok(())
    }
}

pub(super) fn cap() -> u64 {
    std::env::var("NTS_SNAPSHOT_CACHE_MAX")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(2 * 1024 * 1024 * 1024)
}

/// Publish only after reserving room under the same lock every writer uses.
/// A partial write can temporarily add at most one entry beyond the cap;
/// successful publications leave the complete pool at or below it.
pub(super) fn publish(
    dir: &Utf8Path,
    entry: (&Utf8Path, &[u8]),
    hint: (&Utf8Path, &[u8]),
) -> io::Result<()> {
    let mut budget = Budget::acquire(dir)?;
    budget.collect_age(dir, SystemTime::now())?;
    let cap = cap();
    let incoming = u64::try_from(entry.1.len())
        .unwrap_or(u64::MAX)
        .saturating_add(u64::try_from(hint.1.len()).unwrap_or(u64::MAX));
    let protected = [entry.0, hint.0];
    let previous = || -> io::Result<u64> { Ok(size(entry.0)?.saturating_add(size(hint.0)?)) };
    if incoming > cap {
        // A large answer still returns fresh; it must not evict the whole cache
        // merely to store an entry the configured budget cannot retain.
        if budget.ledger.used > cap {
            let mut pool = Pool::read(dir)?;
            pool.evict(cap - cap / 4, &[])?;
            budget.ledger.used = pool.total;
        }
        return budget.finish(dir);
    }
    let mut replaced = previous()?;
    if budget
        .ledger
        .used
        .saturating_sub(replaced)
        .saturating_add(incoming)
        > cap
    {
        let mut pool = Pool::read(dir)?;
        pool.evict(
            (cap - cap / 4)
                .saturating_sub(incoming)
                .saturating_add(replaced),
            &protected,
        )?;
        budget.ledger.used = pool.total;
        replaced = previous()?;
    }
    if budget
        .ledger
        .used
        .saturating_sub(replaced)
        .saturating_add(incoming)
        > cap
    {
        return Err(io::Error::other(
            "cache budget could not reserve publication",
        ));
    }
    atomic_write(entry.0, entry.1)?;
    atomic_write(hint.0, hint.1)?;
    budget.ledger.used = budget
        .ledger
        .used
        .saturating_sub(replaced)
        .saturating_add(incoming);
    budget.finish(dir)
}

fn size(path: &Utf8Path) -> io::Result<u64> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => Ok(meta.len()),
        Ok(_) => Err(io::Error::other("cache payload is not a file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error),
    }
}

fn last_use(meta: &Metadata) -> SystemTime {
    meta.accessed()
        .or_else(|_| meta.modified())
        .unwrap_or(UNIX_EPOCH)
}

/// Access time is an explicit last-use marker; mtime remains the publication
/// time, so a hit cannot look like a rewritten snapshot to the cache gate.
pub(super) fn touch(path: &Utf8Path) {
    if let Ok(file) = File::options().write(true).open(path) {
        let _ = file.set_times(std::fs::FileTimes::new().set_accessed(SystemTime::now()));
    }
}

struct Payload {
    used_at: SystemTime,
    size: u64,
    path: Utf8PathBuf,
}

struct Pool {
    files: Vec<Payload>,
    total: u64,
}

impl Pool {
    fn read(dir: &Utf8Path) -> io::Result<Self> {
        #[cfg(test)]
        SCANS.with(|count| count.set(count.get() + 1));
        let mut files = Vec::new();
        let mut total = 0_u64;
        for directory in [dir.to_owned(), dir.join("manifests")] {
            let listing = match std::fs::read_dir(directory) {
                Ok(listing) => listing,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            for entry in listing {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let meta = match entry.metadata() {
                    Ok(meta) => meta,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                };
                total = total.saturating_add(meta.len());
                files.push(Payload {
                    used_at: last_use(&meta),
                    size: meta.len(),
                    path: Utf8PathBuf::from_path_buf(entry.path())
                        .map_err(|_| io::Error::other("non-UTF8 cache payload"))?,
                });
            }
        }
        Ok(Self { files, total })
    }

    fn remove(&mut self, index: usize) -> io::Result<()> {
        let file = &self.files[index];
        match std::fs::remove_file(&file.path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        self.total = self.total.saturating_sub(file.size);
        self.files.swap_remove(index);
        Ok(())
    }

    fn remove_old(&mut self, now: SystemTime) -> io::Result<()> {
        for index in (0..self.files.len()).rev() {
            if now
                .duration_since(self.files[index].used_at)
                .is_ok_and(|age| age > Duration::from_hours(7 * 24))
            {
                self.remove(index)?;
            }
        }
        Ok(())
    }

    fn evict(&mut self, target: u64, protected: &[&Utf8Path]) -> io::Result<()> {
        self.files
            .sort_by_key(|file| std::cmp::Reverse(file.used_at));
        for index in (0..self.files.len()).rev() {
            if self.total <= target {
                break;
            }
            if !protected.contains(&self.files[index].path.as_path()) {
                self.remove(index)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn collect_at(dir: &Utf8Path, now: SystemTime) {
    let _ = (|| -> io::Result<()> {
        let mut budget = Budget::acquire(dir)?;
        budget.collect_age(dir, now)?;
        budget.finish(dir)
    })();
}

#[cfg(test)]
pub(super) fn collect_old(dir: &Utf8Path, now: SystemTime) {
    if let Ok(mut pool) = Pool::read(dir) {
        let _ = pool.remove_old(now);
    }
}

#[cfg(test)]
pub(super) fn sweep(dir: &Utf8Path, cap: u64) {
    if let Ok(mut pool) = Pool::read(dir) {
        let _ = pool.evict(cap, &[]);
    }
}

#[cfg(test)]
thread_local! { static SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(Utf8PathBuf);
    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .expect("utf8")
                .join(format!("nts-budget-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch");
            Self(dir)
        }
        fn publish(&self, key: usize) {
            publish(
                &self.0,
                (&self.0.join(format!("{key}.postcard")), &[7; 128]),
                (&self.0.join(format!("manifests/{key}.manifest")), &[8; 64]),
            )
            .expect("publish");
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn ordinary_publications_do_not_rescan_the_pool() {
        let scratch = Scratch::new("constant-accounting");
        scratch.publish(0);
        let after_first = SCANS.with(std::cell::Cell::get);
        for key in 1..32 {
            scratch.publish(key);
        }
        assert_eq!(
            SCANS.with(std::cell::Cell::get),
            after_first,
            "the byte ledger, not a per-case directory scan, must track ordinary writes"
        );
        let ledger: Ledger = read_value(&scratch.0.join(".budget/state")).expect("ledger");
        assert!(!ledger.dirty);
        assert_eq!(ledger.used, Pool::read(&scratch.0).expect("pool").total);
    }

    #[test]
    fn an_interrupted_publication_reconciles_the_dirty_ledger() {
        let scratch = Scratch::new("interrupted");
        scratch.publish(0);
        let budget = Budget::acquire(&scratch.0).expect("begin interrupted writer");
        atomic_write(&scratch.0.join("abandoned.partial"), &[9; 1024]).expect("orphan");
        drop(budget); // The process can disappear at any publication boundary.
        scratch.publish(1);
        let ledger: Ledger = read_value(&scratch.0.join(".budget/state")).expect("ledger");
        assert!(!ledger.dirty);
        assert_eq!(ledger.used, Pool::read(&scratch.0).expect("pool").total);
        std::fs::write(scratch.0.join(".budget/state"), "corrupt").expect("corrupt state");
        scratch.publish(2);
        let ledger: Ledger =
            read_value(&scratch.0.join(".budget/state")).expect("recovered ledger");
        assert_eq!(ledger.used, Pool::read(&scratch.0).expect("pool").total);
    }

    #[test]
    fn replacement_accounting_counts_each_payload_once() {
        let scratch = Scratch::new("replacement");
        for _ in 0..8 {
            scratch.publish(0);
        }
        let ledger: Ledger = read_value(&scratch.0.join(".budget/state")).expect("ledger");
        assert_eq!(ledger.used, 192);
        assert_eq!(ledger.used, Pool::read(&scratch.0).expect("pool").total);
    }
}
