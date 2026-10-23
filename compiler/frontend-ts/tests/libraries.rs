//! `SymbolRecord::library`: which library declares a symbol the program does
//! not, against a real tsgo. Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::{Library, SemanticSnapshot};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/libraries/tsconfig.json")
        .canonicalize_utf8()
        .expect("the libraries fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

#[test]
fn a_symbol_the_program_does_not_declare_names_its_library() {
    let Some(snapshot) = snapshot() else { return };
    let library = |name: &str| {
        let records: Vec<_> = snapshot
            .symbols
            .iter()
            .filter(|record| record.name == name)
            .collect();
        assert!(
            !records.is_empty(),
            "no symbol `{name}`; diagnostics {:?}",
            snapshot
                .diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>()
        );
        records[0].library.clone()
    };
    assert_eq!(library("JSON"), Some(Library::Es));
    assert_eq!(library("document"), Some(Library::Dom));
    assert_eq!(library("process"), Some(Library::Node));
    // The program's own: declared in a decoded file.
    assert_eq!(library("own"), None);
}
