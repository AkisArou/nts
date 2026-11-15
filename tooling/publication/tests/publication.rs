#[path = "../../../compiler/test-support/scratch.rs"]
mod scratch;

use nts_publication::{DirectoryPublication, directory, publish};
use std::fs;
use std::sync::{Arc, Barrier};

#[test]
fn changing_target_names_keeps_only_one_parent_lock_file() {
    let root = scratch::StdScratchDir::in_std_target("publication-parent-lock");
    for name in ["old-version", "current-version", "next-version"] {
        let held = nts_publication::lock(&root.join(name)).expect("parent lock");
        drop(held);
    }
    let entries: Vec<_> = fs::read_dir(&root)
        .expect("parent entries")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    assert_eq!(entries.len(), 1);
    assert!(nts_publication::private_name(&entries[0]));
}

#[test]
fn nested_surface_flow_uses_different_parents_and_same_parent_reentry_refuses() {
    let root = scratch::StdScratchDir::in_std_target("publication-nested-locks");
    let identity = root.join("identity");
    let target = identity.join("version/fingerprint");
    let outer = nts_publication::lock(&identity).expect("surface identity lock");
    let inner = nts_publication::lock(&target).expect("different-parent commit lock");
    let refused = nts_publication::lock(&root.join("another-identity"))
        .expect_err("same thread must refuse instead of blocking");
    assert!(
        refused
            .to_string()
            .contains("is already held by this process")
    );
    drop(inner);
    directory(
        &target,
        |path| {
            fs::create_dir(path)?;
            fs::write(path.join("complete"), "whole")
        },
        |path| Ok(path.join("complete").is_file()),
    )
    .expect("actual nested directory publication");
    drop(outer);
    drop(
        nts_publication::lock(&root.join("another-identity"))
            .expect("released parent can be reacquired"),
    );
}

#[cfg(unix)]
#[test]
fn a_parent_alias_cannot_hide_same_thread_reentry() {
    let root = scratch::StdScratchDir::in_std_target("publication-lock-alias");
    let held = nts_publication::lock(&root.join("one")).expect("parent lock");
    std::os::unix::fs::symlink(&root, root.join("alias")).expect("parent alias");
    assert!(
        nts_publication::lock(&root.join("alias/two"))
            .expect_err("canonical parent reentry")
            .to_string()
            .contains("is already held by this process")
    );
    drop(held);
}

#[test]
fn two_writers_publish_whole_files_and_leave_foreign_staging_alone() {
    let root = scratch::StdScratchDir::in_std_target("publication-files");
    let target = root.join("target");
    let foreign = root.join(".nts-publication-foreign");
    fs::create_dir(&foreign).expect("publication control");
    fs::write(foreign.join("sentinel"), "kept").expect("publication control");
    let ready = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        for byte in *b"ab" {
            let target = &target;
            let ready = Arc::clone(&ready);
            scope.spawn(move || {
                publish(target, |payload| {
                    assert!(!payload.exists());
                    fs::write(payload, vec![byte; 128 * 1024])?;
                    ready.wait();
                    Ok(())
                })
                .expect("publication control");
            });
        }
    });
    let body = fs::read(&target).expect("publication control");
    assert_eq!(body.len(), 128 * 1024);
    assert!(body.iter().all(|byte| *byte == body[0]));
    assert_eq!(
        fs::read_to_string(foreign.join("sentinel")).expect("publication control"),
        "kept"
    );
    assert_eq!(fs::read_dir(&root).expect("publication control").count(), 2);
}

#[test]
fn two_directory_writers_complete_and_the_second_reuses_a_whole_target() {
    let root = scratch::StdScratchDir::in_std_target("publication-directories");
    let target = root.join("target");
    let ready = Arc::new(Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let workers: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|value| {
                let target = &target;
                let ready = Arc::clone(&ready);
                scope.spawn(move || {
                    directory(
                        target,
                        |payload| {
                            fs::create_dir(payload)?;
                            fs::write(payload.join("body"), value)?;
                            fs::write(payload.join("complete"), value)?;
                            ready.wait();
                            Ok(())
                        },
                        |path| {
                            Ok(fs::read(path.join("body")).is_ok_and(|body| {
                                fs::read(path.join("complete")).ok() == Some(body)
                            }))
                        },
                    )
                    .expect("publication control")
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().expect("publication control"))
            .collect::<Vec<_>>()
    });
    assert!(results.contains(&DirectoryPublication::Published));
    assert!(results.contains(&DirectoryPublication::Reused));
    assert_eq!(
        fs::read(target.join("body")).expect("publication control"),
        fs::read(target.join("complete")).expect("publication control")
    );
}

#[test]
fn an_invalid_directory_is_replaced_and_failed_production_keeps_the_old_target() {
    let root = scratch::StdScratchDir::in_std_target("publication-repair");
    let target = root.join("target");
    fs::create_dir(&target).expect("publication control");
    fs::write(target.join("old"), "old").expect("publication control");
    let valid = |path: &std::path::Path| Ok(path.join("complete").is_file());
    let refused = directory(
        &target,
        |_| Err(std::io::Error::other("producer failed")),
        valid,
    )
    .expect_err("publication must refuse");
    assert!(refused.to_string().contains("producer failed"));
    assert_eq!(
        fs::read_to_string(target.join("old")).expect("publication control"),
        "old"
    );
    assert_eq!(
        directory(
            &target,
            |path| {
                fs::create_dir(path)?;
                fs::write(path.join("complete"), "new")
            },
            valid
        )
        .expect("publication control"),
        DirectoryPublication::Published
    );
    assert!(!target.join("old").exists());
    assert_eq!(
        fs::read_to_string(target.join("complete")).expect("publication control"),
        "new"
    );
}

#[test]
fn pid_only_staging_control_removes_the_first_writers_unfinished_directory() {
    let root = scratch::StdScratchDir::in_std_target("pid-only-control");
    // Supplied process identity, deliberately the old surfaces recipe: both
    // calls in one process alias. The real fixture path stays scratch-owned.
    let process_identity = 12345;
    let old = || root.join(format!("partial-{process_identity}"));
    let first = old();
    fs::create_dir(&first).expect("publication control");
    fs::write(first.join("unfinished"), "first").expect("publication control");
    let second = old();
    assert_eq!(first, second);
    fs::remove_dir_all(&second).expect("publication control");
    fs::create_dir(&second).expect("publication control");
    assert!(
        !first.join("unfinished").exists(),
        "the old second writer destroyed the first writer's staging"
    );
}

#[test]
fn a_refused_file_rename_preserves_the_old_target_without_a_remove_fallback() {
    let root = scratch::StdScratchDir::in_std_target("publication-refusal");
    let target = root.join("target");
    fs::create_dir(&target).expect("old target directory");
    fs::write(target.join("sentinel"), "old").expect("old target sentinel");
    let error = publish(&target, |path| fs::write(path, "new file"))
        .expect_err("file cannot atomically replace directory");
    assert!(error.to_string().contains("atomic publication"));
    assert_eq!(
        fs::read_to_string(target.join("sentinel")).expect("old target survives"),
        "old"
    );
}

#[cfg(unix)]
#[test]
fn concurrent_links_replace_a_legacy_directory_under_the_same_owner() {
    let root = scratch::StdScratchDir::in_std_target("publication-legacy-links");
    let target = root.join("target");
    let store = root.join("store");
    fs::create_dir(&target).expect("legacy copy");
    fs::create_dir(&store).expect("selected store");
    fs::write(target.join("legacy"), "old").expect("legacy bytes");
    let ready = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        for _ in 0..2 {
            let (target, store, ready) = (&target, &store, Arc::clone(&ready));
            scope.spawn(move || {
                nts_publication::publish_over_directory(target, |path| {
                    std::os::unix::fs::symlink(store, path)?;
                    ready.wait();
                    Ok(())
                })
                .expect("link published");
            });
        }
    });
    assert_eq!(fs::read_link(target).expect("selected link"), store);
}
