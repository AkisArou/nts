//! A limit on how many threads run language-server request work at once: Go's `GOMAXPROCS` for the goroutines a
//! request starts.
//!
//! The language server starts a thread per request in flight (`tsrs_lsp` `workerpool`), so a request never waits for
//! one that is blocked, as with Go's goroutine per request. Go runs at most `GOMAXPROCS` goroutines at once, though,
//! and a burst of requests here made as many threads runnable as there were requests. Under a CPU quota smaller than
//! the machine (a container with 8 CPUs of quota on a 64-CPU host), the kernel spread them over many CPUs and spent
//! more time than the requests did (40 concurrent folding range requests: 9 s of system time in 1.2 s, 4x the time
//! of running them one at a time).
//!
//! A job takes a slot to run (`run`) and gives it back while it waits for something another job may hold
//! (`blocking`: a checker, a client response, another thread forcing a lazy list), as a blocked goroutine gives back
//! its P, so a waiting job never keeps a runnable one from running. A wait that is not marked only keeps its slot.
//! A job coming back from `blocking` takes its slot back without waiting, even over capacity: it may hold a lock
//! that every slot holder is waiting for, and waiting for a slot there would deadlock. New jobs (`run`) still wait
//! until fewer than the capacity run.
//! Threads that never took a slot (the dispatch loop, background tasks) are not limited, and `blocking` is a no-op
//! on them.

use std::cell::Cell;
use std::num::NonZeroUsize;
use std::sync::{Condvar, Mutex, OnceLock};

/// A process-wide worker limit must be configured before native work starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerBudgetError {
    /// An explicit budget has already been configured.
    AlreadyConfigured,
    /// A native program, request slot or worker pool has already started.
    WorkAlreadyStarted,
}

impl std::fmt::Display for WorkerBudgetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::AlreadyConfigured => "the native worker budget is already configured",
            Self::WorkAlreadyStarted => "native work started before the worker budget was configured",
        })
    }
}

impl std::error::Error for WorkerBudgetError {}

struct WorkerBudget {
    limit: Option<NonZeroUsize>,
    started: bool,
}

impl WorkerBudget {
    fn configure(&mut self, limit: NonZeroUsize) -> Result<(), WorkerBudgetError> {
        if self.started {
            return Err(WorkerBudgetError::WorkAlreadyStarted);
        }
        if self.limit.is_some() {
            return Err(WorkerBudgetError::AlreadyConfigured);
        }
        self.limit = Some(limit);
        Ok(())
    }

    fn start(&mut self) -> Option<NonZeroUsize> {
        self.started = true;
        self.limit
    }
}

static WORKER_BUDGET: Mutex<WorkerBudget> = Mutex::new(WorkerBudget { limit: None, started: false });

/// Set an upper bound shared by native compiler parsing, binding, checking and
/// request execution slots. Call once, before creating any native program or worker pool.
/// An explicit budget takes precedence over pool-specific environment settings.
pub fn configure_worker_budget(limit: NonZeroUsize) -> Result<(), WorkerBudgetError> {
    WORKER_BUDGET.lock().unwrap_or_else(std::sync::PoisonError::into_inner).configure(limit)
}

/// Read the configured limit without starting native work.
pub fn worker_budget() -> Option<NonZeroUsize> {
    WORKER_BUDGET.lock().unwrap_or_else(std::sync::PoisonError::into_inner).limit
}

/// Freeze the budget before constructing native programs, pools or request
/// slots. The lock orders configuration against concurrent first use.
pub fn start_worker_pool() -> Option<NonZeroUsize> {
    WORKER_BUDGET.lock().unwrap_or_else(std::sync::PoisonError::into_inner).start()
}

struct Slots {
    in_use: Mutex<usize>,
    freed: Condvar,
    capacity: usize,
}

thread_local! {
    static HOLDS_SLOT: Cell<bool> = const { Cell::new(false) };
}

fn get_slots() -> &'static Slots {
    static SLOTS: OnceLock<Slots> = OnceLock::new();
    SLOTS.get_or_init(|| Slots {
        in_use: Mutex::new(0),
        freed: Condvar::new(),
        capacity: start_worker_pool()
            .unwrap_or_else(|| std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN))
            .get(),
    })
}

/// Runs `f` once a slot is free, holding it while `f` runs (outside of `blocking` calls). A nested `run` keeps the
/// slot it has.
pub fn run<R>(f: impl FnOnce() -> R) -> R {
    if HOLDS_SLOT.with(Cell::get) {
        return f();
    }
    acquire();
    let _release = ReleaseOnDrop;
    f()
}

/// Runs `f`, which waits, without holding this thread's slot, and takes its slot back before returning (without
/// waiting for one to be free).
pub fn blocking<R>(f: impl FnOnce() -> R) -> R {
    if !HOLDS_SLOT.with(Cell::get) {
        return f();
    }
    release();
    let _reacquire = ReacquireOnDrop;
    f()
}

fn acquire() {
    let s = get_slots();
    let mut in_use = s.in_use.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    while *in_use >= s.capacity {
        in_use = s.freed.wait(in_use).unwrap_or_else(std::sync::PoisonError::into_inner);
    }
    *in_use += 1;
    HOLDS_SLOT.with(|h| h.set(true));
}

fn release() {
    HOLDS_SLOT.with(|h| h.set(false));
    let s = get_slots();
    *s.in_use.lock().unwrap_or_else(std::sync::PoisonError::into_inner) -= 1;
    s.freed.notify_one();
}

// Also on unwind: a panicking job (recovered by the server) gives its slot back.
struct ReleaseOnDrop;

impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        release();
    }
}

struct ReacquireOnDrop;

impl Drop for ReacquireOnDrop {
    fn drop(&mut self) {
        let s = get_slots();
        *s.in_use.lock().unwrap_or_else(std::sync::PoisonError::into_inner) += 1;
        HOLDS_SLOT.with(|h| h.set(true));
    }
}

#[cfg(test)]
fn capacity() -> usize {
    get_slots().capacity
}

#[cfg(test)]
#[path = "runslots_test.rs"]
mod runslots_test;
