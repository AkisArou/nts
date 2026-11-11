//! The same owner cleans direct cargo tests and checked-runner namespaces.
#![allow(clippy::expect_used, clippy::unwrap_used)]
#[path = "../../test-support/scratch.rs"]
mod scratch;

#[test]
fn scratch_child() {
    let Ok(mode) = std::env::var("NTS_SCRATCH_PROBE") else {
        return;
    };
    let name = if mode.starts_with("nested-") {
        "guard-control/longer/right"
    } else {
        "guard-control"
    };
    let dir = scratch::ScratchDir::in_target(name);
    let path = dir.to_path_buf();
    let root = path
        .ancestors()
        .nth(std::path::Path::new(name).components().count())
        .unwrap()
        .to_owned();
    std::fs::write(dir.join("partial-output"), "partial compiler output").unwrap();
    if mode.ends_with("unwind") {
        assert!(
            std::panic::catch_unwind(move || {
                let _owner = dir;
                panic!("compiler test failed");
            })
            .is_err()
        );
    } else {
        drop(dir);
    }
    assert!(!path.exists(), "scratch survived {mode}: {path}");
    assert!(!root.exists(), "private root survived {mode}: {root}");
}

#[test]
fn plain_cargo_fallback_cleans_on_return_and_unwind() {
    for mode in ["return", "unwind", "nested-return", "nested-unwind"] {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "scratch_child", "--nocapture"])
            .env_remove("NTS_TEST_SCRATCH_ROOT")
            .env("NTS_KEEP_TEST_SCRATCH", "0")
            .env("NTS_SCRATCH_PROBE", mode)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
