//! The correctness gate: a program that does not typecheck is not compilable.
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the pinned
//! binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::Severity;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::SemanticSnapshot;

fn snapshot_of(fixture: &str) -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    Some(
        TsgoApi::new(tsgo)
            .snapshot(&tsconfig)
            .expect("a snapshot is produced even for a broken program"),
    )
}

#[test]
fn a_program_with_type_errors_is_reported_as_having_errors() {
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
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
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
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
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
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
    let Some(snapshot) = snapshot_of("types") else {
        return;
    };
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
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
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
    let snapshot = TsgoApi::new(tsgo)
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

#[test]
fn diagnostics_cost_two_exchanges_a_file() {
    let Some(tsgo) = std::env::var("NTS_TSGO")
        .ok()
        .map(Utf8PathBuf::from)
        .filter(|path| path.exists())
    else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/types/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let mut source = TsgoApi::new(tsgo);
    source.snapshot(&tsconfig).unwrap();
    let stats = source.stats();

    // Three fixed exchanges for the session, five per file to read it, and
    // two per file for its syntactic and semantic diagnostics. Asked of the
    // whole program instead, the diagnostics were two exchanges and a check
    // of the default library besides, whose diagnostics the frontend drops:
    // the exchanges are nearly free (`docs/records/0345`), the check is not.
    assert_eq!(stats.round_trips, 3 + 7 * u64::from(stats.files));
}

/// A plain-JS file's early errors beyond TypeScript's own `plainJSErrors` reach the
/// snapshot: `f() = 1` is a `SyntaxError` in JavaScript and TS2364 to the checker,
/// which drops it for a `.js` file with `checkJs` unset unless asked through the
/// carried patch `typescript-go-plain-js-unfiltered`. This is the binary half of
/// that patch's guard: a stale `target/tsgo` without it answers nothing here.
#[test]
fn a_plain_javascript_early_error_is_reported() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
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
    let snapshot = TsgoApi::new(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .expect("a snapshot is produced even for a broken program");
    assert!(
        snapshot
            .diagnostics
            .iter()
            .any(|d| d.code == "TS2364" && d.severity == Severity::Error),
        "TS2364 is not reported for a plain-JS file: target/tsgo lacks the carried \
         patch (run `sh tooling/bootstrap/bootstrap.sh`), or `EARLY_ERRORS` lost it. \
         Got: {:?}",
        snapshot
            .diagnostics
            .iter()
            .map(|d| d.code.as_str())
            .collect::<Vec<_>>()
    );
}
