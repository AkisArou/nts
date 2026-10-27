//! Several emit commands' answers, with one frontend and lowering.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

struct Fixture(PathBuf);

impl Fixture {
    fn new(source: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("multi-emit-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.ts"), source).unwrap();
        std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"types":[]},"files":["main.ts"]}"#).unwrap();
        Self(root)
    }

    fn run(&self, command: &str, out: &Path, flags: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .args([command, "--no-acquire", "--out"])
            .arg(out)
            .args(flags)
            .arg(self.0.join("tsconfig.json"))
            .output()
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn inventory(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, at: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        if !at.exists() {
            return;
        }
        for entry in std::fs::read_dir(at).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

fn report(out: &Path) -> serde_json::Value {
    serde_json::from_slice(
        &std::fs::read(out.join("emit.json")).expect("each backend needs its own result"),
    )
    .unwrap()
}

#[test]
fn combined_emission_is_the_same_files_and_bytes_as_each_command() {
    let fixture = Fixture::new(
        "import { doubled } from './helper';\nexport function twice(n: number): number { return doubled(n); }\nconsole.log(twice(21));\n",
    );
    std::fs::write(
        fixture.0.join("helper.ts"),
        "export function doubled(n: number): number { return (n * 2) | 0; }\n",
    )
    .unwrap();
    for flags in [vec![], vec!["--main"], vec!["--entry", "twice"]] {
        let out = fixture.0.join(format!("combined-{}", flags.join("-")));
        let mut combined_flags = vec!["--backends", "c,llvm,jvm"];
        combined_flags.extend(&flags);
        let combined = fixture.run("emit", &out, &combined_flags);
        assert!(
            combined.status.success(),
            "{}",
            String::from_utf8_lossy(&combined.stderr)
        );
        let results = report(&out);
        assert_eq!(results["version"], 1);
        for backend in ["c", "llvm", "jvm"] {
            let own = fixture.0.join(format!("separate-{backend}"));
            let separate = fixture.run(&format!("emit-{backend}"), &own, &flags);
            assert!(
                separate.status.success(),
                "{backend}: {}",
                String::from_utf8_lossy(&separate.stderr)
            );
            let expected = inventory(&own);
            assert!(!expected.is_empty(), "{backend} control emitted nothing");
            assert_eq!(
                inventory(&out.join(backend)),
                expected,
                "{backend}: {flags:?}"
            );
            assert_eq!(
                results["backends"][backend]["exit_code"],
                separate.status.code().unwrap()
            );
            assert_eq!(
                results["backends"][backend]["stderr"],
                String::from_utf8(separate.stderr).unwrap()
            );
            let combined_stdout = results["backends"][backend]["stdout"]
                .as_str()
                .unwrap()
                .replace(out.join(backend).to_str().unwrap(), "<out>");
            let separate_stdout = String::from_utf8(separate.stdout)
                .unwrap()
                .replace(own.to_str().unwrap(), "<out>");
            assert_eq!(
                combined_stdout, separate_stdout,
                "{backend}'s link/output messages"
            );
            std::fs::remove_dir_all(own).unwrap();
        }
    }
}

#[test]
fn a_managed_provider_failure_does_not_stop_a_later_native_backend() {
    let fixture = Fixture::new("export function answer(): number { return 42; }\n");
    let out = fixture.0.join("provider");
    let combined = fixture.run("emit", &out, &["--backends", "jvm,c,llvm", "--rc"]);
    assert!(!combined.status.success());
    let results = report(&out);
    for backend in std::iter::once("jvm") {
        assert_eq!(results["backends"][backend]["exit_code"], 1);
        assert!(
            results["backends"][backend]["stderr"]
                .as_str()
                .unwrap()
                .contains(&format!("{backend} declines --rc"))
        );
        assert!(inventory(&out.join(backend)).is_empty());
    }
    for backend in ["c", "llvm"] {
        assert_eq!(results["backends"][backend]["exit_code"], 0);
        assert!(out.join(backend).join("program.c").is_file());
    }
}

#[test]
fn an_output_failure_does_not_stop_the_next_backend() {
    let fixture = Fixture::new("export function answer(): number { return 42; }\n");
    let out = fixture.0.join("io-failure");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join("c"), "a file is not an output directory").unwrap();
    let combined = fixture.run("emit", &out, &["--backends", "c,jvm"]);
    assert!(!combined.status.success());
    let results = report(&out);
    assert_eq!(results["backends"]["c"]["exit_code"], 1);
    assert_eq!(results["backends"]["jvm"]["exit_code"], 0);
    assert!(out.join("jvm/nts-runtime.jar").is_file());
}

#[test]
fn sharing_avoids_two_actual_raw_lowerings() {
    let fixture = Fixture::new("export function answer(): number { return 42; }\n");
    let trace = fixture.0.join("lowerings");
    let invoke = |command: &str, out: &Path, flags: &[&str]| {
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args([command, "--no-acquire", "--out"])
            .arg(out)
            .args(flags)
            .arg(fixture.0.join("tsconfig.json"))
            .env("NTS_TRACE_LOWERING", &trace)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    invoke(
        "emit",
        &fixture.0.join("one"),
        &["--backends", "c,llvm,jvm"],
    );
    assert_eq!(
        std::fs::read_to_string(&trace).unwrap().lines().count(),
        1,
        "count the actual lower_with boundary, not a claimed statistic"
    );
    std::fs::remove_file(&trace).unwrap();
    for backend in ["c", "llvm", "jvm"] {
        invoke(&format!("emit-{backend}"), &fixture.0.join(backend), &[]);
    }
    assert_eq!(
        std::fs::read_to_string(trace).unwrap().lines().count(),
        3,
        "the unshared control must really lower once per backend"
    );
}

#[test]
fn a_frontend_error_blocks_every_backend_with_the_original_diagnostic() {
    let fixture = Fixture::new("export const wrong: string = 1;\n");
    let out = fixture.0.join("type-error");
    let combined = fixture.run("emit", &out, &["--backends", "c,llvm,jvm"]);
    assert!(!combined.status.success());
    let results = report(&out);
    for backend in ["c", "llvm", "jvm"] {
        let own = fixture.0.join(format!("error-{backend}"));
        let separate = fixture.run(&format!("emit-{backend}"), &own, &[]);
        assert!(!separate.status.success());
        assert_eq!(results["backends"][backend]["status"], "blocked");
        assert_eq!(
            results["backends"][backend]["stderr"],
            String::from_utf8(separate.stderr).unwrap()
        );
        assert!(inventory(&out.join(backend)).is_empty());
    }
}

#[test]
fn malformed_requests_fail_before_frontend_acquisition() {
    let fixture = Fixture::new("export const answer = 42;\n");
    let out = fixture.0.join("bad-request");
    for (flags, complaint) in [
        (vec![], "requires --backends"),
        (vec!["--backends", ""], "nonempty value"),
        (vec!["--backends", "c,c"], "requested more than once"),
        (vec!["--backends", "c,llvmm"], "unknown backend"),
        (vec!["--backends", "c,"], "unknown backend"),
        (
            vec!["--backends", "c", "--backends=llvm"],
            "given more than once",
        ),
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["emit", "--no-acquire", "--out"])
            .arg(&out)
            .args(flags)
            .arg(&fixture.0)
            .output()
            .unwrap();
        assert!(!result.status.success());
        let text = String::from_utf8(result.stderr).unwrap();
        assert!(text.contains(complaint), "{text}");
        assert!(!out.exists());
    }
}
