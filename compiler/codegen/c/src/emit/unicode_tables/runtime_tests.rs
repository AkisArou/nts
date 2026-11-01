#![allow(clippy::unwrap_used)]

use std::process::Command;

#[test]
fn an_owned_result_resizes_without_another_logical_allocation() {
    let dir = std::env::temp_dir().join(format!("nts-unicode-resize-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for support in crate::support_files(super::UnicodeNeeds::ALL) {
        support.write(&dir).unwrap();
    }
    std::fs::write(dir.join("resize.c"), include_str!("resize_probe.c")).unwrap();
    for provider in ["nogc", "rc"] {
        let mut build = Command::new("clang");
        build.current_dir(&dir).args([
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-fsanitize=address,undefined",
            "-fno-omit-frame-pointer",
            "resize.c",
            "-lm",
            "-o",
            provider,
        ]);
        if provider == "rc" {
            build.args(["-DNTS_PROVIDER_RC", "-DNTS_POISON=1"]);
        }
        let built = build.output().unwrap();
        assert!(built.status.success(), "{built:?}");
        let ran = Command::new(dir.join(provider))
            .env("ASAN_OPTIONS", "detect_leaks=0")
            .output()
            .unwrap();
        assert!(ran.status.success(), "{ran:?}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn native_identity_runs_respect_tails_mapping_and_ownership() {
    if Command::new("clang").arg("--version").output().is_err() {
        eprintln!("SKIP native Unicode runtime: clang unavailable");
        return;
    }
    let dir = std::env::temp_dir().join(format!("nts-unicode-kernels-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for support in crate::support_files(super::UnicodeNeeds::ALL) {
        support.write(&dir).unwrap();
    }
    std::fs::write(dir.join("probe.c"), include_str!("runtime_probe.c")).unwrap();
    let built = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-DNTS_PROVIDER_RC",
            "-fsanitize=address,undefined",
            "-fno-omit-frame-pointer",
            "probe.c",
            "nts_runtime.c",
            "-lm",
            "-o",
            "probe",
        ])
        .output()
        .unwrap();
    assert!(built.status.success(), "{built:?}");
    let ran = Command::new(dir.join("probe")).output().unwrap();
    assert!(ran.status.success(), "{ran:?}");
    assert_eq!(
        String::from_utf8(ran.stdout).unwrap(),
        "identity kernels agree\n"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
