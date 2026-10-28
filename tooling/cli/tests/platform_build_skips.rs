//! Missing platform capabilities skip before a product build is requested.
#![cfg(unix)]

use std::path::Path;
use std::process::Command;

fn executable(path: &Path, text: &str) {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::write(path, text).expect("fixture script");
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("executable");
}

#[test]
fn unavailable_apple_and_windows_capabilities_skip_before_invoking_nts() {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("platform-build-skips-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&root));
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).expect("tools");
    for tool in ["clang", "ld64.lld", "llvm-objdump", "zig"] {
        executable(&bin.join(tool), "#!/bin/sh\nexit 0\n");
    }
    let marker = root.join("compiler-was-invoked");
    let compiler = bin.join("nts");
    executable(
        &compiler,
        &format!("#!/bin/sh\ntouch '{}'\nexit 99\n", marker.display()),
    );
    let windows = root.join("tooling/windows");
    std::fs::create_dir_all(&windows).expect("Windows tooling");
    executable(
        &windows.join("fetch-win32metadata.sh"),
        "#!/bin/sh\nexit 1\n",
    );
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/interop");
    for (project, reason) in [
        ("macos-classes", "no macOS SDK"),
        ("ios-hello", "no iOS simulator SDK"),
        ("windows-com", "no Win32 metadata"),
    ] {
        let dir = root.join("tests/interop").join(project);
        std::fs::create_dir_all(&dir).expect("interop fixture");
        let script = dir.join("build.sh");
        std::fs::copy(source.join(project).join("build.sh"), &script)
            .expect("actual interop script");
        let result = Command::new("sh")
            .arg(&script)
            .arg(root.join("out"))
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    bin.display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            )
            .env("NTS_BIN", &compiler)
            .env("NTS_APPLE_ROOT", root.join("missing-sdk"))
            .env("NTS_APPLE_SDK", root.join("missing-sdk"))
            .env("NTS_IOS_SIMULATOR_SDK", root.join("missing-sdk"))
            .output()
            .expect("platform preflight");
        assert!(
            result.status.success(),
            "{project}: {}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        let text = String::from_utf8_lossy(&result.stdout);
        assert!(
            text.contains("SKIP") && text.contains(reason),
            "{project}: {text}"
        );
        assert!(
            !marker.exists(),
            "{project} invoked the compiler before its platform skip"
        );
        assert!(
            !root.join("out").exists(),
            "{project} wrote build output before its platform skip"
        );
    }
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}
