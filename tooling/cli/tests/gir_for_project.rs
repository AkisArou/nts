//! Config-less commands use the Linux host's GIR bindings, just as configured
//! projects do. Each run starts without linked bindings or a snapshot cache.
//! Side-effect imports are not covered here: they report TS2882 rather than
//! the named import's TS2307.

#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::Command;

const CONTROL: &str = "export function answer(n: number): number { return n + 1; }\n";

struct Project(PathBuf);

impl Project {
    fn new(name: &str, gir: bool) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the clock")
            .as_nanos();
        let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "gir-for-project-{name}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("creating the project");
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("the repository");
        std::fs::write(
            root.join("tsconfig.json"),
            serde_json::json!({
                "extends": repo.join("tsconfig.fixtures.json"),
                "files": ["main.ts", repo.join("runtime/native/libc.d.ts")],
            })
            .to_string(),
        )
        .expect("writing the tsconfig");
        // The sole difference from the control: an unresolved GIR import.
        // The shipped cairo GIR keeps this project-opening test small.
        let source = if gir {
            format!("import type {{ Context }} from \"gi:cairo\";\n{CONTROL}")
        } else {
            CONTROL.to_owned()
        };
        std::fs::write(root.join("main.ts"), source).expect("writing the program");
        assert!(!root.join("nts.config.ts").exists());
        assert!(!root.join("node_modules").exists());
        Self(root)
    }

    fn run(&self, command: &str) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg(command)
            .arg(self.0.join("tsconfig.json"))
            .env("NTS_TYPES_ROOT", self.0.join("store"))
            .output()
            .expect("running the CLI")
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).expect("removing the private project");
    }
}

fn available() -> bool {
    let tools = ["clang", "pkg-config"].iter().all(|tool| {
        Command::new(tool)
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
    });
    let cairo = Command::new("pkg-config")
        .args(["--exists", "cairo-gobject"])
        .status()
        .is_ok_and(|status| status.success());
    if tools && cairo {
        return true;
    }
    assert!(
        std::env::var_os("NTS_TESTS_REQUIRE_TOOLING").is_none(),
        "needs tsgo, clang, pkg-config and cairo-gobject headers"
    );
    eprintln!("skipped: needs tsgo, clang, pkg-config and cairo-gobject headers");
    false
}

#[test]
fn configless_commands_resolve_gir_imports() {
    if !available() {
        return;
    }
    for command in ["hir", "emit-c"] {
        for gir in [false, true] {
            let project = Project::new(command, gir);
            let output = project.run(command);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success(),
                "{command}, GIR import {gir}: {stderr}\n{stdout}"
            );
            assert!(!stdout.contains("Cannot find module"), "{stdout}");
            assert!(!stderr.contains("Cannot find module"), "{stderr}");
            assert!(!stderr.contains("not compiled"), "{stderr}");
            assert!(stdout.contains("answer("), "{command}: {stdout}");
            assert_eq!(
                project.0.join("node_modules/@nts/gi-cairo").exists(),
                gir,
                "{command}: GIR packages should be linked only for a GIR import"
            );
        }
    }
}
