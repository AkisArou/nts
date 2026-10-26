//! The correctness gate: a program that does not typecheck is not compilable.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::Severity;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::SemanticSnapshot;

fn frontend() -> Frontend {
    Frontend::new(env!("CARGO_MANIFEST_DIR")).with_checkers(std::num::NonZeroU16::MIN)
}

fn snapshot_of(fixture: &str) -> SemanticSnapshot {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{fixture} is checked in"));
    frontend()
        .snapshot(&tsconfig)
        .expect("a snapshot is produced even for a broken program")
}

#[test]
fn a_program_with_type_errors_is_reported_as_having_errors() {
    let snapshot = snapshot_of("invalid");
    assert!(
        snapshot.has_errors(),
        "the invalid fixture must not be reported as compilable",
    );
    let errors: Vec<_> = snapshot
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert_eq!(errors.len(), 2, "the fixture has exactly two type errors");
}

#[test]
fn diagnostics_keep_typescripts_own_codes() {
    let snapshot = snapshot_of("invalid");
    // `TS2322` stays greppable against TypeScript's own documentation. Renumbering
    // into a private scheme would make every error harder to look up.
    assert!(
        snapshot
            .diagnostics
            .iter()
            .all(|d| d.code.starts_with("TS")),
        "diagnostics should carry TypeScript codes",
    );
    assert!(
        snapshot.diagnostics.iter().any(|d| d.code == "TS2322"),
        "assignability errors are TS2322",
    );
}

#[test]
fn a_diagnostic_points_at_a_real_source_and_span() {
    let snapshot = snapshot_of("invalid");
    for diagnostic in &snapshot.diagnostics {
        let source = snapshot
            .sources
            .get(diagnostic.primary.file.0 as usize)
            .expect("diagnostic names a decoded source");
        // A location pointing at the wrong file is worse than none, because it
        // sends a reader somewhere real.
        assert!(source.uri.ends_with("main.ts"));
        assert!(diagnostic.primary.span.start < diagnostic.primary.span.end);
    }
}

#[test]
fn a_clean_program_reports_no_errors() {
    let snapshot = snapshot_of("types");
    assert!(
        !snapshot.has_errors(),
        "clean fixture reported errors: {:?}",
        snapshot.diagnostics,
    );
}

/// **A program's own type error is still reported**, in a file the config
/// names and in one only an import reaches. Diagnostics are asked of the
/// files the frontend compiles, not of the whole program, and checking fewer
/// files reads exactly like checking the right ones until an error goes
/// missing.
#[test]
fn a_type_error_in_any_of_the_programs_files_is_reported() {
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!("nts-diagnostics-own-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("main.ts"),
        "import { twice } from \"./other\";\nexport const named: string = twice(2);\n",
    )
    .unwrap();
    std::fs::write(dir.join("other.ts"), "export function twice(value: number): number {\n  const wrong: boolean = value;\n  return value * 2;\n}\n").unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "strict": true, "noEmit": true, "target": "es2022", "module": "esnext" }, "files": ["main.ts"] }"#,
    )
    .unwrap();
    let tsconfig = dir.join("tsconfig.json").canonicalize_utf8().unwrap();
    let snapshot = frontend()
        .snapshot(&tsconfig)
        .expect("a snapshot is produced even for a broken program");
    let errors: Vec<(&str, &str)> = snapshot
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == Severity::Error)
        .map(|diagnostic| {
            (
                diagnostic.code.as_str(),
                snapshot.sources[diagnostic.primary.file.0 as usize]
                    .uri
                    .as_str(),
            )
        })
        .collect();
    for file in ["main.ts", "other.ts"] {
        assert!(
            errors
                .iter()
                .any(|(code, uri)| *code == "TS2322" && uri.ends_with(file)),
            "the type error in {file} was not reported: {errors:?}"
        );
    }
}

/// A plain-JS file's early errors beyond TypeScript's own `plainJSErrors` reach the
/// snapshot: `f() = 1` is a `SyntaxError` in JavaScript and TS2364 to the checker,
/// which drops it for a `.js` file with `checkJs` unset. The adapter separates
/// those facts so only the frontend's measured early-error allowlist adds them.
#[test]
fn a_plain_javascript_early_error_is_reported() {
    let dir = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("plain-js-early-error");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "allowJs": true, "module": "esnext", "target": "es2022", "noEmit": true }, "include": ["src"] }"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("src/main.js"),
        "function f() { return 1; }\nf() = 1;\n",
    )
    .unwrap();
    let snapshot = frontend()
        .snapshot(&dir.join("tsconfig.json"))
        .expect("a snapshot is produced even for a broken program");
    assert!(
        snapshot
            .diagnostics
            .iter()
            .any(|d| d.code == "TS2364" && d.severity == Severity::Error),
        "TS2364 must pass through the plain-JS early-error policy. Got: {:?}",
        snapshot
            .diagnostics
            .iter()
            .map(|d| d.code.as_str())
            .collect::<Vec<_>>()
    );
}

#[test]
fn unchecked_javascript_and_plain_javascript_keep_distinct_diagnostic_policies() {
    let dir = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("js-checking-policy");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("main.js"),
        "function f() { return 1; }\nf() = 1;\nconst distinct = 0n === 1n;\n",
    )
    .unwrap();
    for (name, check, expected) in [
        ("plain", "", vec!["TS2364"]),
        ("unchecked", ", \"checkJs\": false", vec![]),
        ("checked", ", \"checkJs\": true", vec!["TS2364", "TS2367"]),
    ] {
        let config = dir.join(format!("{name}.json"));
        std::fs::write(
            &config,
            format!(
                "{{\"compilerOptions\":{{\"allowJs\":true,\"target\":\"es2022\",\"noEmit\":true{check}}},\"files\":[\"main.js\"]}}"
            ),
        )
        .unwrap();
        let snapshot = frontend().snapshot(&config).unwrap();
        let mut codes: Vec<_> = snapshot
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == Severity::Error)
            .map(|diagnostic| diagnostic.code.as_str())
            .collect();
        codes.sort_unstable();
        assert_eq!(codes, expected, "{name} checking policy");
    }
}
