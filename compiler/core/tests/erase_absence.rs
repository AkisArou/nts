//! Which absence a null pointer is, erasing into a wider declaration, is the
//! *value's* question: `const v: string | null | undefined = n < 10 ? null :
//! "x"` holds a `string | null` pointer, so its erasure says `null`. Asked of
//! the declaration -- both absences -- it said neither (`Absent::Impossible`):
//! C answered `null` by its default and Wasm refused by name.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Absent, OpKind};
use nts_frontend_ts::SemanticSource;

#[test]
fn an_erasure_into_a_wider_declaration_says_which_absence_the_value_is() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/erase-absence/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let lowered = hir::lower::lower(&snapshot);
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == "wider")
        .expect("`wider` is lowered");
    let absences: Vec<Absent> = func
        .values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::Erase { absent, .. } => Some(absent),
            _ => None,
        })
        .collect();
    assert_eq!(absences, [Absent::Null], "{absences:?}");
}
