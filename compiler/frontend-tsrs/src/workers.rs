//! Process-wide operational limits, configured before native work starts.

use std::num::{NonZeroU16, NonZeroUsize};

/// A compiler worker budget cannot change after its first configuration or use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum WorkerBudgetError {
    #[error("compiler worker budget is already configured")]
    AlreadyConfigured,
    #[error("compiler worker budget must be configured before native work starts")]
    WorkAlreadyStarted,
}

/// Configure every native compiler pool and adapter checker request once.
/// Session creation never reconfigures this process-wide setting.
pub fn configure_worker_budget(workers: NonZeroU16) -> Result<(), WorkerBudgetError> {
    tsrs_core::runslots::configure_worker_budget(NonZeroUsize::from(workers)).map_err(|error| {
        match error {
            tsrs_core::runslots::WorkerBudgetError::AlreadyConfigured => {
                WorkerBudgetError::AlreadyConfigured
            }
            tsrs_core::runslots::WorkerBudgetError::WorkAlreadyStarted => {
                WorkerBudgetError::WorkAlreadyStarted
            }
        }
    })
}

/// The explicit operational limit, independent of visible CPUs and environment.
#[must_use]
pub fn worker_budget() -> Option<NonZeroUsize> {
    tsrs_core::runslots::worker_budget()
}

pub(crate) fn start() -> Option<NonZeroU16> {
    tsrs_core::runslots::start_worker_pool().map(|count| {
        NonZeroU16::new(u16::try_from(count.get().min(256)).expect("256 fits in a u16"))
            .expect("a nonzero native worker budget remains nonzero after clamping")
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn the_native_pool_uses_the_budget_and_rejects_late_changes() {
        if std::env::var_os("NTS_NATIVE_WORKER_CONTROL").is_some() {
            configure_worker_budget(NonZeroU16::MIN).unwrap();
            assert_eq!(tsrs_compiler::worker_pool().current_num_threads(), 1);
            assert_eq!(
                configure_worker_budget(NonZeroU16::MIN),
                Err(WorkerBudgetError::WorkAlreadyStarted)
            );
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "workers::tests::the_native_pool_uses_the_budget_and_rejects_late_changes",
                "--nocapture",
            ])
            .env("NTS_NATIVE_WORKER_CONTROL", "1")
            .env("RAYON_NUM_THREADS", "8")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn vfs_first_use_freezes_the_budget_and_shares_the_compiler_pool() {
        if let Ok(mode) = std::env::var("NTS_VFS_WORKER_CONTROL") {
            let count = match mode.as_str() {
                "one" => Some(NonZeroU16::MIN),
                "two" => NonZeroU16::new(2),
                "default" => None,
                _ => panic!("unknown VFS worker control"),
            };
            if let Some(count) = count {
                configure_worker_budget(count).unwrap();
            }
            #[cfg(target_os = "linux")]
            let before = std::fs::read_dir("/proc/self/task").unwrap().count();
            let host = tsrs_vfs::vfstest::from_map(
                [
                    ("/dev/a.ts", ""),
                    ("/dev/sub/b.ts", ""),
                    ("/dev/skip.js", ""),
                ],
                true,
            );
            let files = tsrs_vfs::vfsmatch::read_directory(
                &host,
                "/dev",
                "/dev",
                &[".ts"],
                &[] as &[&str],
                &["**/*"],
                tsrs_vfs::vfsmatch::UNLIMITED_DEPTH,
            );
            assert_eq!(files, ["/dev/a.ts", "/dev/sub/b.ts"]);
            assert_eq!(
                configure_worker_budget(NonZeroU16::MIN),
                Err(WorkerBudgetError::WorkAlreadyStarted)
            );
            #[cfg(target_os = "linux")]
            if mode == "one" {
                assert_eq!(
                    std::fs::read_dir("/proc/self/task").unwrap().count(),
                    before,
                    "serial VFS discovery must not start Rayon's global workers"
                );
            }
            let pool = tsrs_vfs::worker_pool();
            let expected = if tsrs_core::NO_THREADS {
                1
            } else {
                usize::from(count.map_or(8, NonZeroU16::get))
            };
            assert_eq!(pool.current_num_threads(), expected);
            assert!(std::ptr::eq(pool, tsrs_compiler::worker_pool()));
            return;
        }
        for mode in ["one", "two", "default"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "workers::tests::vfs_first_use_freezes_the_budget_and_shares_the_compiler_pool",
                    "--nocapture",
                ])
                .env("NTS_VFS_WORKER_CONTROL", mode)
                .env("RAYON_NUM_THREADS", "8")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{mode}: {}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
}
