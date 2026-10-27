//! One byte-level guard covers the four backends, including emitted sources,
//! packaged classes, native objects, and Wasm's source-origin metadata.
#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        drop(std::fs::remove_dir_all(&self.0));
    }
}

fn artifacts(root: &Path, directory: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
    for entry in std::fs::read_dir(directory).expect("artifact directory") {
        let path = entry.expect("artifact entry").path();
        if path.is_dir() {
            artifacts(root, &path, files);
        } else {
            let name = path
                .strip_prefix(root)
                .expect("relative artifact")
                .to_owned();
            files.insert(name, std::fs::read(path).expect("artifact bytes"));
        }
    }
}

#[test]
fn all_backends_build_identical_bytes_in_different_environments() {
    for (tool, flag) in [
        ("node", "--version"),
        ("clang", "--version"),
        ("jar", "--version"),
        ("javac", "-version"),
    ] {
        if !nts_codegen_jvm::toolchain::command(tool)
            .arg(flag)
            .output()
            .is_ok_and(|out| out.status.success())
        {
            assert!(
                std::env::var_os("NTS_TESTS_REQUIRE_TOOLING").is_none(),
                "{tool} is required"
            );
            eprintln!("SKIP deterministic builds: {tool} is not available");
            return;
        }
    }
    let fixture = Fixture(
        Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("deterministic-all-{}", std::process::id())),
    );
    drop(std::fs::remove_dir_all(&fixture.0));
    // Different depth also changes the relative spelling of SDK include paths.
    let trees = [fixture.0.join("left"), fixture.0.join("much/deeper/right")];
    let mut outputs = Vec::new();
    for (index, tree) in trees.iter().enumerate() {
        let app = build_project(tree, index);
        let root = app.join(".nts/build");
        let mut files = BTreeMap::new();
        artifacts(&root, &root, &mut files);
        for required in [
            "c/linux-gnu-x86_64/program.c",
            "c/linux-gnu-x86_64/libc.so",
            "llvm/linux-gnu-x86_64/program.ll",
            "llvm/linux-gnu-x86_64/libllvm.so",
            "jvm/java-8/jvm.jar",
            "wasm/program.wasm",
            "wasm/program.mjs",
            "wasm/program.instance.mjs",
            "wasm/program.origins.json",
        ] {
            assert!(
                !files.get(Path::new(required)).expect(required).is_empty(),
                "empty {required}"
            );
        }
        assert!(
            files
                .keys()
                .any(|path| path.extension().is_some_and(|ext| ext == "class")),
            "no emitted JVM classes"
        );
        outputs.push(files);
    }
    assert_eq!(
        outputs[0].keys().collect::<Vec<_>>(),
        outputs[1].keys().collect::<Vec<_>>(),
        "artifact inventories differ"
    );
    let changed: Vec<_> = outputs[0]
        .iter()
        .filter(|(path, bytes)| outputs[1][*path] != **bytes)
        .map(|(path, _)| path)
        .collect();
    assert!(
        changed.is_empty(),
        "artifacts depend on path/depth, cwd, TMPDIR, time or timezone: {changed:?}"
    );
    let origins = String::from_utf8_lossy(&outputs[0][Path::new("wasm/program.origins.json")]);
    assert!(
        origins.contains("nts-workspace:///../shared/helper.ts"),
        "the outside helper lost its origin: {origins}"
    );
}

fn project(tree: &Path) -> PathBuf {
    let app = tree.join("app");
    std::fs::create_dir_all(app.join("src")).expect("sources");
    std::fs::create_dir_all(tree.join("shared")).expect("external helper");
    std::fs::create_dir_all(app.join("node_modules/@nts")).expect("config package");
    std::os::unix::fs::symlink(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../config"),
        app.join("node_modules/@nts/config"),
    )
    .expect("linking config package");
    std::fs::write(app.join("src/main.ts"), "import { format } from '../../shared/helper.ts';\nexport function text(n: number): string { let value = n; const step = (): number => { value += 0.25; return value; }; return format(step()); }\nconsole.log(text(1));\n").expect("entry");
    std::fs::write(
        tree.join("shared/helper.ts"),
        "export function format(n: number): string { return String(n); }\n",
    )
    .expect("helper");
    std::fs::write(app.join("tsconfig.json"), r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"types":[],"allowImportingTsExtensions":true,"noEmit":true},"files":["src/main.ts"]}"#).expect("tsconfig");
    std::fs::write(
        app.join("nts.config.ts"),
        r"
import { defineConfig, library, target } from '@nts/config';
export default defineConfig({
  build: { cache: { local: false } },
  products: {
c: library.native({ entry: './src/main.ts', targets: [target.linux({backend: 'c'})] }),
llvm: library.native({ entry: './src/main.ts', targets: [target.linux({backend: 'llvm'})] }),
jvm: library.jvm({ entry: './src/main.ts', release: 8 })
  }
});
",
    )
    .expect("build config");
    app
}

fn build_project(tree: &Path, index: usize) -> PathBuf {
    let app = project(tree);
    let tmp = tree.join("tmp");
    std::fs::create_dir_all(&tmp).expect("TMPDIR");
    if index > 0 {
        // ZIP's legacy timestamps have a two-second resolution.
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    for backend in ["c", "llvm", "jvm", "wasm"] {
        // NTS_BIN also lets this exact guard run against a pinned old compiler.
        let compiler =
            std::env::var_os("NTS_BIN").unwrap_or_else(|| env!("CARGO_BIN_EXE_nts").into());
        let mut command = Command::new(compiler);
        command
            .arg(if backend == "wasm" {
                "emit-wasm"
            } else {
                "build"
            })
            .arg(app.join("tsconfig.json"))
            .arg("--product")
            .arg(if backend == "wasm" { "c" } else { backend })
            .current_dir(if index == 0 { &app } else { tree })
            .env("TMPDIR", &tmp)
            .env(
                "TZ",
                if index == 0 {
                    "UTC"
                } else {
                    "Pacific/Kiritimati"
                },
            )
            .env("NTS_NO_SNAPSHOT_CACHE", "1")
            .env("NTS_CHECKERS", "1");
        if backend == "wasm" {
            command.arg("--out").arg(app.join(".nts/build/wasm"));
        }
        let out = command.output().expect("building deterministic artifacts");
        assert!(
            out.status.success(),
            "{backend}: {}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            !String::from_utf8_lossy(&out.stderr).contains("NTS"),
            "{backend} refused code: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    app
}
