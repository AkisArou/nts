//! The same owner cleans direct cargo tests and checked-runner namespaces.
#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::scratch;

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
        let output = crate::self_test::run("test_scratch::scratch_child", |command| {
            command
                .env_remove("NTS_TEST_SCRATCH_ROOT")
                .env("NTS_KEEP_TEST_SCRATCH", "0")
                .env("NTS_SCRATCH_PROBE", mode);
        });
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "child did not run: {output:?}"
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn a_returned_value_owns_its_files_until_the_value_is_dropped() {
    let value = {
        let dir = scratch::ScratchDir::in_target("returned-value");
        let file = dir.join("main.ts");
        std::fs::write(&file, "export const value = 1;").unwrap();
        dir.hold(file)
    };
    let path = value.to_owned();
    let last = value.share();
    drop(value);
    assert!(path.exists(), "the returned value still owns its source");
    drop(last);
    if std::env::var_os("NTS_KEEP_TEST_SCRATCH").is_none_or(|v| v != "1") {
        assert!(!path.exists(), "dropping the last owner removes its files");
    }
}

#[test]
fn a_shared_fixture_cache_keeps_no_static_scratch_owner() {
    static CACHE: scratch::SharedScratch<camino::Utf8PathBuf> = scratch::SharedScratch::new();
    let first = CACHE
        .get(|| Some(scratch::ScratchDir::in_target("shared-value")))
        .unwrap();
    let second = CACHE
        .get(|| panic!("an overlapping caller reuses the fixture"))
        .unwrap();
    let path = first.to_owned();
    drop(first);
    assert!(path.exists());
    drop(second);
    if std::env::var_os("NTS_KEEP_TEST_SCRATCH").is_none_or(|v| v != "1") {
        assert!(!path.exists(), "the weak cache never retains scratch");
    }
}

#[test]
fn a_stale_self_spawn_filter_fails_instead_of_passing_zero_tests() {
    crate::self_test::run("test_scratch::scratch_child", |_| {});
    let failure =
        std::panic::catch_unwind(|| crate::self_test::run("test_scratch::missing_child", |_| {}))
            .expect_err("an obsolete test name must fail");
    let message = failure
        .downcast_ref::<String>()
        .expect("named self-test failure");
    assert!(message.contains("test_scratch::missing_child"), "{message}");
    assert!(message.contains("0 passed"), "{message}");
}
