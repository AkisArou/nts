mod vfs;
mod walkdir;

pub use vfs::*;
pub use walkdir::*;

pub mod bundled;
pub mod cachedvfs;
pub mod internal;
pub mod iovfs;
pub mod osvfs;
pub mod trackingvfs;
pub mod vfsmatch;
pub mod vfstest;
pub mod wrapvfs;

#[cfg(test)]
mod walkdir_test;

// Parsing and binding recurse deeply on large files; Go's goroutine stacks grow on demand, so the
// worker threads get large stacks. The pool has at most WORKER_THREAD_CAP threads: with the heap on 4 KiB pages
// (mimalloc `no_thp`, notes/mem-no-thp.md) the parallel parse is bound by page-fault contention, not threads (vscode
// on 64 vCPUs: 0.124 s at 32 threads, 0.131 s at 64), and every allocating thread keeps its own partly filled
// allocator pages and arena chunk tail (64 -> 32 threads: -0.09 GiB peak). RAYON_NUM_THREADS still sets the count
// exactly, as before (single-threaded runs with `node bench/bench.mjs count` use 1).
const WORKER_THREAD_CAP: usize = 32;

/// Shared VFS, parsing and binding pool. Configure the process worker budget
/// before the first directory traversal or compiler request.
///
/// Runs worker jobs on the calling thread for threadless targets.
///
/// `tsrs_core::NO_THREADS` targets: a one-thread pool on the calling thread (`use_current_thread`), on which
/// `install`, `par_iter`, `broadcast` and nested scopes run inline. It must be the first rayon use on that
/// thread: once rayon's global pool has started there, building it fails with "The current thread is already
/// part of another thread pool", so an embedder calls `worker_pool()` before anything else.
pub fn worker_pool() -> &'static rayon::ThreadPool {
    static POOL: std::sync::OnceLock<rayon::ThreadPool> = std::sync::OnceLock::new();
    POOL.get_or_init(|| {
        let budget = tsrs_core::runslots::start_worker_pool();
        if tsrs_core::NO_THREADS {
            return rayon::ThreadPoolBuilder::new()
                .num_threads(1)
                .use_current_thread()
                .build()
                .unwrap();
        }
        let threads = budget.map(std::num::NonZero::get).unwrap_or_else(|| {
            std::env::var("RAYON_NUM_THREADS")
                .ok()
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|&n| n > 0)
                .unwrap_or_else(|| {
                    std::thread::available_parallelism()
                        .map_or(1, std::num::NonZero::get)
                        .min(WORKER_THREAD_CAP)
                })
        });
        rayon::ThreadPoolBuilder::new().num_threads(threads).stack_size(256 << 20).build().unwrap()
    })
}

