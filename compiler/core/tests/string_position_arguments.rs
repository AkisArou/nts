//! No-position calls retain their original entry points; an explicit position
//! reaches each backend as one already-numeric scalar, with no boxing.
#![allow(clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};

#[test]
fn optional_positions_preserve_the_unboxed_no_position_path() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/string-position-arguments/tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the source typechecks");
    assert!(!snapshot.has_errors());
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    for (name, expected) in [
        (
            "plain",
            vec![
                "nts_str_index_of",
                "nts_str_last_index_of",
                "nts_str_includes",
                "nts_str_starts_with",
                "nts_str_ends_with",
            ],
        ),
        (
            "positioned",
            vec![
                "nts_str_index_of_from",
                "nts_str_last_index_of_from",
                "nts_str_includes_from",
                "nts_str_starts_with_at",
                "nts_str_ends_with_at",
            ],
        ),
    ] {
        let func = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .expect("the export is present");
        let live = func
            .blocks
            .iter()
            .flat_map(|b| &b.ops)
            .map(|id| &func.value(*id).kind)
            .collect::<Vec<_>>();
        let helpers = live
            .iter()
            .filter_map(|op| match op {
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                } => Some(name.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(helpers, expected, "{name}");
        assert!(
            !live.iter().any(|op| matches!(
                op,
                OpKind::TagOf { .. } | OpKind::Erase { .. } | OpKind::Unerase { .. }
            )),
            "{name} boxed its native position"
        );
    }
}

#[test]
fn string_needle_admission_keeps_checked_casts_and_rejects_nullable_claims() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/string-needle-claims/tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the source typechecks");
    assert!(!snapshot.has_errors());
    let lowered = hir::lower::lower(&snapshot);
    for name in ["produced", "literal", "checked"] {
        assert!(
            lowered.program.funcs.iter().any(|f| f.name == name),
            "{name} lost admission: {:?}",
            lowered.program.uncompiled
        );
    }
    for name in ["typed", "widened", "checkedNullable"] {
        assert!(
            lowered.program.uncompiled.iter().any(|f| f.name == name),
            "{name} bypassed nullable admission"
        );
    }
}

#[test]
fn raw_absence_admission_is_owned_by_the_argument_contract() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/builtin-absence-admission/tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the source typechecks");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot);
    assert!(
        lowered.program.funcs.iter().any(|f| f.name == "position"),
        "{:?}",
        lowered.program.uncompiled
    );
    for name in ["storage", "replacement"] {
        assert!(
            lowered.program.uncompiled.iter().any(|f| f.name == name),
            "{name} bypassed ordinary source admission"
        );
    }
}
