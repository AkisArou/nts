//! A program whose only possible growth is index stores that are all in range
//! is a program whose arrays cannot grow (`bounds::prove_stores_cannot_grow`).
//!
//! `stores-in-range` fills and updates `new Array(n)` under `i < n`: every
//! check in `filled` goes, and `arrays_can_grow` answers no. Its control adds
//! one store, `xs[n]`, which appends: the assumption fails as a whole, the
//! program's arrays can grow, and a store stays checked.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared(program: &str) -> Option<hir::Program> {
    let frontend = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("tests/programs/{program}/tsconfig.json"));
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    Some(hir::prepare(&snapshot).expect("prepared HIR").program)
}

fn checked_accesses(program: &hir::Program, name: &str) -> usize {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name || func.name.starts_with(&format!("{name}__")))
        .unwrap_or_else(|| panic!("{name} is compiled"));
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|value| {
            matches!(
                func.value(**value).kind,
                OpKind::ArrayGet { checked: true, .. } | OpKind::ArraySet { checked: true, .. }
            )
        })
        .count()
}

#[test]
fn stores_proven_in_range_leave_no_array_able_to_grow() {
    let Some(program) = prepared("stores-in-range") else {
        return;
    };
    assert!(!hir::arrays_can_grow(&program));
    for func in program
        .funcs
        .iter()
        .filter(|func| func.name.starts_with("filled"))
    {
        assert_eq!(checked_accesses(&program, &func.name), 0, "{}", func.name);
    }
}

#[test]
fn one_store_that_appends_keeps_every_array_able_to_grow() {
    let Some(program) = prepared("stores-in-range-control") else {
        return;
    };
    assert!(hir::arrays_can_grow(&program));
    assert!(
        program
            .funcs
            .iter()
            .filter(|func| func.name.starts_with("filled"))
            .any(|func| checked_accesses(&program, &func.name) > 0),
        "the appending store keeps its check"
    );
}
