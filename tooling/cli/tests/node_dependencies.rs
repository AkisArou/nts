#![cfg(all(target_os = "linux", target_arch = "x86_64"))]
use nts_build::node_deps::{Artifacts, Request};
use std::{
    os::unix::fs::PermissionsExt as _,
    path::{Path, PathBuf},
    process::Command,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repository")
}
fn run(command: &mut Command) -> std::process::Output {
    let output = command.output().expect("run native control");
    assert!(
        output.status.success(),
        "{command:?}\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
fn directory(name: &str) -> PathBuf {
    let path =
        PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}", std::process::id()));
    if path.exists() {
        std::fs::remove_dir_all(&path).expect("old test output");
    }
    std::fs::create_dir_all(&path).expect("test directory");
    path
}
fn artifacts(path: &Path, libraries: &[&str]) -> Artifacts {
    let request = Request {
        target: "x86_64-unknown-linux-gnu".into(),
        compiler: vec!["clang".into()],
        archiver: vec!["llvm-ar".into()],
        flags: vec![],
        libraries: libraries.iter().map(|name| (*name).to_owned()).collect(),
        cache: path.join("cache"),
        jobs: 2,
    };
    let file = path.join("request.json");
    std::fs::write(&file, serde_json::to_vec(&request).expect("request")).expect("write request");
    let output = run(Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("node-deps")
        .arg(file));
    serde_json::from_slice(&output.stdout).expect("artifact manifest")
}

#[test]
fn old_environment_cleanup_cannot_clear_a_replacement_or_another_thread() {
    let dir = directory("node-loop-env");
    let repo = root();
    let artifacts = artifacts(&dir, &["uv"]);
    let original = std::fs::read_to_string(repo.join("runtime/node/internal/process.c"))
        .expect("runtime source");
    let guard = "if (nts_host_env != (napi_env)origin) return;";
    assert_eq!(original.matches(guard).count(), 1);
    let mutant = dir.join("old-cleanup.c");
    std::fs::write(&mutant, original.replace(guard, "(void)origin;"))
        .expect("old-cleanup mutation");
    for (name, source, expected) in [
        ("current", repo.join("runtime/node/internal/process.c"), 0),
        ("old-cleanup", mutant, 3),
    ] {
        let output = dir.join(name);
        run(Command::new("clang")
            .args(["-std=c11", "-O2", "-ffunction-sections", "-fdata-sections"])
            .args(&artifacts.include_flags)
            .arg(format!("-I{}", repo.join("runtime/c").display()))
            .arg(format!(
                "-I{}",
                repo.join("runtime/node/internal").display()
            ))
            .arg(format!("-I{}", repo.join("third_party/node/src").display()))
            .arg(repo.join("tooling/cli/tests/fixtures/node-loop-env.c"))
            .arg(source)
            .arg(repo.join("runtime/node/internal/loop.c"))
            .args(&artifacts.link_flags)
            .arg("-Wl,--gc-sections")
            .arg("-o")
            .arg(&output));
        assert_eq!(
            Command::new(output).status().expect("loop control").code(),
            Some(expected)
        );
    }
}

#[test]
fn private_uv_symbols_and_host_loops_work_across_addons_and_workers() {
    let dir = directory("node-loop-addon");
    let repo = root();
    let artifacts = artifacts(&dir, &["uv"]);
    let mut addons = Vec::new();
    for name in ["first", "second", "interposed"] {
        let output = dir.join(format!("{name}.node"));
        let mut command = Command::new("clang");
        command
            .args([
                "-shared",
                "-fPIC",
                "-O2",
                "-ffunction-sections",
                "-fdata-sections",
                "-fvisibility=hidden",
            ])
            .args(&artifacts.include_flags)
            .arg(format!("-I{}", repo.join("runtime/c").display()))
            .arg(format!(
                "-I{}",
                repo.join("runtime/node/internal").display()
            ))
            .arg(format!("-I{}", repo.join("third_party/node/src").display()))
            .arg(repo.join("tooling/cli/tests/fixtures/node-loop-addon.c"))
            .arg(repo.join("runtime/node/internal/process.c"))
            .arg(repo.join("runtime/node/internal/loop.c"))
            .args(
                artifacts.link_flags.iter().filter(|flag| {
                    name != "interposed" || flag.as_str() != "-Wl,--exclude-libs,ALL"
                }),
            )
            .args(["-Wl,--gc-sections", "-o"])
            .arg(&output);
        run(&mut command);
        let symbols = run(Command::new("nm")
            .args(["-D", "--defined-only"])
            .arg(&output));
        let uv_exported = String::from_utf8_lossy(&symbols.stdout)
            .lines()
            .any(|line| {
                line.split_whitespace()
                    .last()
                    .is_some_and(|name| name.starts_with("uv_"))
            });
        assert_eq!(uv_exported, name == "interposed");
        if name != "interposed" {
            run(Command::new("node")
                .arg(repo.join("tooling/gate/node-deps-elf.ts"))
                .arg(&output));
            addons.push(output);
        }
    }
    let driver = repo.join("tooling/cli/tests/fixtures/node-loop-driver.cjs");
    let output = run(Command::new("timeout")
        .args(["30", "node"])
        .arg(&driver)
        .args(&addons));
    assert_eq!(output.stdout, b"host-loop-ok 32 1344\n");
    let mutant = Command::new("timeout")
        .args(["30", "node"])
        .arg(driver)
        .arg(dir.join("interposed.node"))
        .output()
        .expect("interposition control");
    assert_eq!(mutant.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&mutant.stderr).contains("bundled uv must not bind Node symbols")
    );
}

#[test]
fn linked_library_apis_and_process_versions_agree_with_the_pinned_node() {
    let dir = directory("node-versions");
    let repo = root();
    let artifacts = artifacts(&dir, &["uv", "openssl", "brotli", "zlib", "zstd"]);
    let executable = dir.join("versions");
    run(Command::new("clang")
        .args([
            "-std=c11",
            "-O2",
            "-ffunction-sections",
            "-fdata-sections",
            "-Wl,--gc-sections",
        ])
        .args(&artifacts.include_flags)
        .arg(format!("-I{}", repo.join("runtime/c").display()))
        .arg(format!(
            "-I{}",
            repo.join("runtime/node/internal").display()
        ))
        .arg(format!("-I{}", repo.join("runtime/node/process").display()))
        .arg(repo.join("tooling/cli/tests/fixtures/node-deps-versions.c"))
        .arg(repo.join("runtime/node/process/process.c"))
        .arg(repo.join("runtime/node/internal/shared.c"))
        .arg(repo.join("runtime/c/nts_runtime.c"))
        .args(&artifacts.link_flags)
        .args(["-lm", "-o"])
        .arg(&executable));
    let output = run(&mut Command::new(&executable));
    let node = run(Command::new("node").args(["-e", "for(const k of ['node','brotli','openssl','uv','zlib','zstd'])console.log(k+'='+process.versions[k])"]));
    assert_eq!(output.stdout, node.stdout);
    run(Command::new("node")
        .arg(repo.join("tooling/gate/node-deps-elf.ts"))
        .arg(&executable));
    let uv =
        std::fs::read_to_string(&artifacts.notices["node-deps/uv/LICENSE"]).expect("uv notices");
    assert!(uv.contains("Niels Provos") && uv.contains("Internet Systems Consortium"));
    let zlib = std::fs::read_to_string(&artifacts.notices["node-deps/zlib/LICENSE"])
        .expect("zlib notices");
    assert!(zlib.contains("Chromium Authors") && zlib.contains("Redistribution and use"));
}

#[test]
fn standalone_c_and_llvm_link_bundled_uv_with_poisoned_system_discovery() {
    let dir = directory("node-programs");
    let repo = root();
    std::fs::create_dir_all(dir.join("src")).expect("source");
    std::fs::write(dir.join("src/main.ts"), "console.log(42);\n").expect("program");
    std::fs::write(dir.join("tsconfig.json"),r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true},"include":["src/**/*.ts"]}"#).expect("config");
    std::fs::create_dir_all(dir.join("node_modules/@nts")).expect("modules");
    std::os::unix::fs::symlink(
        repo.join("tooling/config"),
        dir.join("node_modules/@nts/config"),
    )
    .expect("config package");
    std::fs::write(dir.join("nts.config.ts"),r"
import {app,defineConfig,target} from '@nts/config';
export default defineConfig({products:{
 viaC:app({kind:'executable',entry:'./src/main.ts',targets:[target.linux({backend:'c',cpu:'baseline'})]}),
 viaLlvm:app({kind:'executable',entry:'./src/main.ts',targets:[target.linux({backend:'llvm',cpu:'baseline'})]})
},dependencies:{'linux-gnu':{from:'pkg-config',packages:['zlib']}}});
").expect("product");
    std::fs::create_dir_all(dir.join("poison/bin")).expect("poison tools");
    std::fs::create_dir_all(dir.join("poison/include")).expect("poison headers");
    std::fs::write(
        dir.join("poison/include/uv.h"),
        "#error machine uv header selected\n",
    )
    .expect("header poison");
    let poison = dir.join("poison/bin/pkg-config");
    std::fs::write(&poison, "#!/bin/sh\nexit 73\n").expect("tool poison");
    std::fs::set_permissions(&poison, std::fs::Permissions::from_mode(0o755)).expect("tool mode");
    let path = std::env::join_paths(std::iter::once(dir.join("poison/bin")).chain(
        std::env::split_paths(&std::env::var_os("PATH").expect("PATH")),
    ))
    .expect("test PATH");
    run(Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(&dir)
        .current_dir(&dir)
        .env("PATH", path)
        .env("CPATH", dir.join("poison/include"))
        .env("XDG_CACHE_HOME", dir.join("cache")));
    for product in ["viaC", "viaLlvm"] {
        let output = dir.join(format!(".nts/build/{product}/linux-gnu-x86_64"));
        let executable = output.join(product);
        assert_eq!(run(&mut Command::new(&executable)).stdout, b"42\n");
        run(Command::new("node")
            .arg(repo.join("tooling/gate/node-deps-elf.ts"))
            .arg(&executable));
        assert!(output.join("notices/node-deps/uv/LICENSE").exists());
        assert!(output.join("notices/node-deps/zlib/LICENSE").exists());
        assert!(!output.join("notices/node-deps/openssl").exists());
    }
}
