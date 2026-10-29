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
        NonZeroU16::new(count.get().min(256) as u16)
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
}
