//! The gate's cargo tests also execute the conformance input-root contracts.

use std::path::Path;
use std::process::Command;

fn repository() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repository")
}

#[test]
fn content_addressed_case_roots_obey_their_contracts() {
    let repo = repository();
    let output = Command::new("node")
        .args(["--test", "tooling/census/project.test.ts"])
        .current_dir(repo)
        .output()
        .expect("node must be installed for the conformance runner");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_materialised_case_has_identical_native_captures_at_one_and_four_checkers() {
    assert_frontend_capture("assert.sameValue(1, 1);", 0);
}

#[test]
fn native_checker_errors_keep_their_count_diagnostics_and_exit() {
    // Plain-JS mode filters type-only errors; TS1189 is a real early error.
    assert_frontend_capture(
        "for (const key = 0 in {}) {} for (const other = 0 in {}) {}",
        2,
    );
}

#[test]
fn frontend_load_failure_is_distinct_from_completed_diagnostics() {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("frontend")
        .arg(repository().join(format!(
            "target/missing-frontend-status-config-{}.json",
            std::process::id()
        )))
        .arg("--no-acquire")
        .output()
        .expect("frontend load failure");
    assert_eq!(output.status.code(), Some(1));
}

#[test]
fn frontend_reports_effective_strictness_without_imposing_a_policy() {
    let base = Path::new(env!("CARGO_TARGET_TMPDIR")).join("reported-checker-strictness");
    for (index, (extends, settings, expected)) in [
        (false, serde_json::json!({}), [true, true, false, false]),
        (false, serde_json::json!({"strict":false}), [false, false, false, false]),
        (false, serde_json::json!({"strict":true,"strictNullChecks":false}), [true, false, false, false]),
        (false, serde_json::json!({"strict":false,"strictNullChecks":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true}), [false, true, true, true]),
        (true, serde_json::json!({"noUncheckedIndexedAccess":false}), [true, true, false, true]),
    ].into_iter().enumerate() {
        let dir = base.join(index.to_string());
        std::fs::create_dir_all(&dir).expect("strictness project directory");
        std::fs::write(dir.join("base.json"), r#"{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true}}"#).expect("inherited options");
        let mut config = serde_json::json!({"compilerOptions":settings,"files":["main.ts"]});
        if extends { config["extends"] = "./base.json".into(); }
        std::fs::write(dir.join("tsconfig.json"), config.to_string()).expect("project config");
        std::fs::write(dir.join("main.ts"), "export const value = 1;").expect("source");
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("frontend").arg(dir.join("tsconfig.json")).arg("--no-acquire")
            .env("NTS_CHECKERS", "1").output().expect("frontend report");
        let stdout = String::from_utf8(output.stdout).expect("report text");
        let stderr = String::from_utf8(output.stderr).expect("diagnostics text");
        assert!(output.status.success(), "{stdout}\n{stderr}");
        for (name, value) in ["strict", "strictNullChecks", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes"].into_iter().zip(expected) {
            let prefix = format!("tsconfig.{name} ");
            let lines: Vec<_> = stdout.lines().filter_map(|line| line.strip_prefix(&prefix)).collect();
            assert_eq!(lines, [value.to_string()], "{name}: {stdout}");
        }
        assert!(!stdout.contains("Warning") && !stderr.contains("Warning"), "metadata does not impose strictness policy: {stdout}\n{stderr}");
    }
}

#[test]
fn compilation_requires_effective_strict_options_and_reports_the_setting_source() {
    let base = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("strict-compile-policy-{}", std::process::id()));
    std::fs::create_dir_all(&base).expect("strict-policy projects");
    let required = [
        "noImplicitAny",
        "strictNullChecks",
        "strictFunctionTypes",
        "strictBindCallApply",
        "strictPropertyInitialization",
        "strictBuiltinIteratorReturn",
        "noImplicitThis",
        "useUnknownInCatchVariables",
        "alwaysStrict",
    ];
    for (index, disabled) in required.into_iter().enumerate() {
        let dir = base.join(index.to_string());
        std::fs::create_dir_all(&dir).expect("project directory");
        std::fs::write(
            dir.join("base.json"),
            serde_json::json!({"compilerOptions":{"strict":true,(disabled):false}}).to_string(),
        )
        .expect("inherited setting");
        std::fs::write(
            dir.join("tsconfig.json"),
            r#"{"extends":"./base.json","files":["main.ts"]}"#,
        )
        .expect("config");
        std::fs::write(dir.join("main.ts"), "export const value = 1;").expect("source");
        std::fs::write(dir.join("nts.config.ts"), format!(
            r#"import {{ defineConfig, library, target }} from "{}";
export default defineConfig({{ products: {{ value: library.native({{ entry: "./main.ts", targets: [target.linux({{ backend: "c" }})] }}) }} }});
"#,
            repository().join("tooling/config/src/index.ts").display(),
        )).expect("a valid build declaration reaches the project policy");
        for command in ["build", "hir", "layouts", "refusals"] {
            let output = Command::new(env!("CARGO_BIN_EXE_nts"))
                .arg(command)
                .arg(dir.join("tsconfig.json"))
                .arg("--no-acquire")
                .env("NTS_CHECKERS", "1")
                .output()
                .expect("strict policy command");
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                !output.status.success(),
                "{command} accepted {disabled}: {text}"
            );
            assert!(
                text.contains("NTS1006") && text.contains(disabled) && text.contains("base.json"),
                "{command}: {text}"
            );
        }
    }
    let dir = base.join("individual");
    std::fs::create_dir_all(&dir).expect("control directory");
    let mut settings = serde_json::Map::new();
    settings.insert("strict".into(), false.into());
    for name in required {
        settings.insert(name.into(), true.into());
    }
    std::fs::write(
        dir.join("tsconfig.json"),
        serde_json::json!({"compilerOptions":settings,"files":["main.ts"]}).to_string(),
    )
    .expect("individually strict config");
    std::fs::write(dir.join("main.ts"), "export const value = 1;").expect("control source");
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["hir", "--prepared"])
        .arg(dir.join("tsconfig.json"))
        .arg("--no-acquire")
        .env("NTS_CHECKERS", "1")
        .output()
        .expect("strict individual control");
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stderr).contains("NTS1006"));
}

fn assert_frontend_capture(text: &str, errors: usize) {
    let repo = repository();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let base = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("live-case-root-{}-{unique}", std::process::id()));
    let roots = base.join("inputs");
    let script = "import {caseRoot,workspace,materialise} from './tooling/census/project.ts';\n\
                  const result=caseRoot(d=>{workspace(d);materialise(d,process.argv[2]);},{base:process.argv[1]});\n\
                  process.stdout.write(JSON.stringify(result));";
    let output = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .arg(&roots)
        .arg(text)
        .current_dir(&repo)
        .output()
        .expect("materialise");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let case: serde_json::Value = serde_json::from_slice(&output.stdout).expect("case root");
    let config = Path::new(case["root"].as_str().expect("root")).join("tsconfig.json");
    let run = |checkers: u16| {
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("frontend")
            .arg(&config)
            .env("NTS_CHECKERS", checkers.to_string())
            .current_dir(&repo)
            .output()
            .expect("frontend");
        assert_eq!(
            output.status.code(),
            Some(if errors == 0 { 0 } else { 2 }),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let text = String::from_utf8(output.stdout).expect("frontend text");
        let field = |name: &str| {
            text.lines()
                .find_map(|line| line.strip_prefix(name))
                .expect("frontend field")
                .trim()
                .to_owned()
        };
        let nodes = field("nodes captured")
            .parse::<u64>()
            .expect("captured node count");
        let diagnostics = text
            .lines()
            .filter(|line| line.starts_with("  Error TS"))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(diagnostics.len(), errors, "all subject errors are reached");
        let stderr = String::from_utf8(output.stderr).expect("stderr");
        if errors > 0 {
            assert_eq!(
                stderr,
                format!("Error: {errors} type error(s); refusing to proceed\n")
            );
        }
        (
            nodes,
            field("snapshot digest"),
            output.status.code(),
            diagnostics,
            stderr,
        )
    };
    let first = run(1);
    let repeated = run(1);
    let four = run(4);
    assert!(
        first.0 > 0,
        "each request must capture the materialized program"
    );
    assert_eq!(
        first, repeated,
        "repeating a native capture changes no facts"
    );
    assert_eq!(first, four, "checker count changes no facts or diagnostics");
    let cleanup = "import {collectCaseRoots} from './tooling/census/project.ts'; collectCaseRoots({base:process.argv[1],now:Date.now()+60000,maxAge:0});";
    let status = Command::new("node")
        .args(["--input-type=module", "-e", cleanup])
        .arg(&roots)
        .current_dir(&repo)
        .status()
        .expect("collect readonly root");
    assert!(status.success());
    std::fs::remove_dir_all(base).expect("remove scratch");
}
