//! A process budget belongs to compiler startup, not individual captures.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::num::NonZeroU16;
use std::process::Command;

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;
use nts_frontend_tsrs::{WorkerBudgetError, configure_worker_budget};

#[test]
fn two_frontends_share_the_budget_and_late_configuration_is_explicit() {
    if let Ok(mode) = std::env::var("NTS_WORKER_BUDGET_CONTROL") {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-worker-budget-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","types":[]},"files":["main.ts"]}"#).unwrap();
        std::fs::write(
            root.join("main.ts"),
            "export function answer(x: number): number { return x + 1; }",
        )
        .unwrap();
        if mode == "configured" {
            configure_worker_budget(NonZeroU16::MIN).unwrap();
            assert_eq!(
                configure_worker_budget(NonZeroU16::MIN),
                Err(WorkerBudgetError::AlreadyConfigured)
            );
        }
        let first = Frontend::new(&root)
            .with_checkers(NonZeroU16::MIN)
            .snapshot(&root.join("tsconfig.json"))
            .unwrap();
        let second = Frontend::new(&root)
            .with_checkers(NonZeroU16::MIN)
            .snapshot(&root.join("tsconfig.json"))
            .unwrap();
        assert_eq!(first.digest().unwrap(), second.digest().unwrap());
        assert_eq!(
            configure_worker_budget(NonZeroU16::new(2).unwrap()),
            Err(WorkerBudgetError::WorkAlreadyStarted)
        );
        std::fs::remove_dir_all(root).unwrap();
        return;
    }
    for mode in ["configured", "default"] {
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "two_frontends_share_the_budget_and_late_configuration_is_explicit",
                "--nocapture",
            ])
            .env("NTS_WORKER_BUDGET_CONTROL", mode)
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
