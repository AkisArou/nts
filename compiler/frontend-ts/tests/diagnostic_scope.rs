//! A kept-file diagnostic scope retains both file and program diagnostics.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::num::NonZeroU16;

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::SemanticSnapshot;

fn snapshot(name: &str, source: &str, options: &str, count: u16) -> SemanticSnapshot {
    let directory = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "diagnostic-scope-{}-{name}-{count}",
        std::process::id()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let config = directory.join("tsconfig.json");
    std::fs::write(
        &config,
        format!(r#"{{"compilerOptions":{{"target":"es2022","strict":true,{options}}},"files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(directory.join("main.ts"), source).unwrap();
    Frontend::new(directory)
        .with_checkers(NonZeroU16::new(count).unwrap())
        .snapshot(&config)
        .unwrap()
}

#[test]
fn selecting_kept_files_still_reports_their_type_errors() {
    for count in [1, 4] {
        let control = snapshot(
            "typed-control",
            "export const x: number = 1;",
            "\"noEmit\":true",
            count,
        );
        assert!(!control.has_errors(), "{:?}", control.diagnostics);
        let rejected = snapshot(
            "typed-error",
            "export const x: number = 'one';",
            "\"noEmit\":true",
            count,
        );
        assert_eq!(
            rejected
                .diagnostics
                .iter()
                .filter(|error| error.code == "TS2322")
                .count(),
            1
        );
    }
}

#[test]
fn selecting_kept_files_still_reports_program_option_errors() {
    for count in [1, 4] {
        let control = snapshot(
            "option-control",
            "export const x = 1;",
            "\"sourceMap\":false,\"inlineSourceMap\":true",
            count,
        );
        assert!(!control.has_errors(), "{:?}", control.diagnostics);
        let rejected = snapshot(
            "option-error",
            "export const x = 1;",
            "\"sourceMap\":true,\"inlineSourceMap\":true",
            count,
        );
        let error = rejected
            .diagnostics
            .iter()
            .find(|error| error.code == "TS5053")
            .expect("mutually exclusive source-map options are a program diagnostic");
        assert!(
            rejected.sources[error.primary.file.0 as usize]
                .display_path
                .ends_with("tsconfig.json")
        );
    }
}
