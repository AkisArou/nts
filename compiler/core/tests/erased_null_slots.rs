//! Erasing an array records what its null slots mean, while its element type
//! is still in hand: `Null` for a `(string | null)[]`, and `Impossible` -- the
//! default an erased read answers `undefined` for -- for its control, a
//! `(string | undefined)[]`. The erased read in `second` sees `any[]` and
//! cannot know; see `OpKind::Erase`'s `slots`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Absent, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn erased_slots(program: &hir::Program, name: &str) -> Vec<Absent> {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("{name} is compiled"));
    func.values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::Erase { value, slots, .. }
                if matches!(
                    func.value(value).ty,
                    hir::HirType::Managed(hir::ManagedType::Array(_))
                ) =>
            {
                Some(slots)
            }
            _ => None,
        })
        .collect()
}

#[test]
fn an_erased_array_says_what_its_null_slots_mean() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/erased-null-slots/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let lowered = hir::lower::lower_with(&snapshot, &[], &rustc_hash::FxHashMap::default());
    let program = &lowered.program;
    assert_eq!(erased_slots(program, "nulls"), [Absent::Null]);
    assert_eq!(erased_slots(program, "undefineds"), [Absent::Impossible]);
}
