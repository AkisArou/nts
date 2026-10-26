//! Existing-record reductions must keep both subject and control exports.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::TypeKind;

#[test]
fn typed_member_and_receiver_repairs_keep_the_complete_fixture_population() {
    for fixture in [
        "a-computed-numeric-accessor-keeps-its-canonical-key",
        "a-static-private-getter-keeps-its-body",
        "a-static-private-accessor-keeps-its-update-order",
        "a-private-member-keeps-its-anonymous-class-receiver",
    ] {
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../tests/programs/{fixture}/tsconfig.json"))
            .canonicalize_utf8()
            .expect("checked-in record reduction");
        let snapshot = Frontend::new(config.parent().unwrap())
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("capture both fixture arms");
        assert!(
            !snapshot.has_errors(),
            "{fixture}: {:?}",
            snapshot.diagnostics
        );
        if fixture == "a-private-member-keeps-its-anonymous-class-receiver" {
            assert!(snapshot.types.iter().any(|record| matches!(
                record.kind,
                TypeKind::TypeParameter {
                    is_this: true,
                    constraint: Some(_),
                    ..
                }
            )));
        }
        let materialized = hir::instantiate::materialise(&snapshot);
        let owned = materialized.as_ref().unwrap_or(&snapshot);
        for (at, record) in snapshot.types.iter().enumerate() {
            if matches!(record.kind, TypeKind::TypeParameter { .. }) {
                assert_eq!(
                    owned.types[at], *record,
                    "receiver facts survive materialization"
                );
            }
        }
        let prepared = hir::prepare(&snapshot).expect("valid member calls and definitions");
        assert!(
            prepared.diagnostics.is_empty(),
            "{fixture}: {:?}",
            prepared.diagnostics
        );
        assert!(
            prepared.program.uncompiled.is_empty(),
            "{fixture}: {:?}",
            prepared.program.uncompiled
        );
        let mut exports = prepared
            .program
            .funcs
            .iter()
            // Module evaluation is an exported runtime root, not a source
            // function. Use its reserved compiler identity, also used by the
            // product's publication/initialization checks.
            .filter(|func| func.exported && func.name != hir::lower::MODULE_INIT)
            .map(|func| func.name.as_str())
            .collect::<Vec<_>>();
        for init in prepared
            .program
            .funcs
            .iter()
            .filter(|func| func.name == hir::lower::MODULE_INIT)
        {
            assert!(init.exported, "module evaluation stays a publication root");
            assert!(init.params.is_empty());
            assert_eq!(init.return_type, hir::HirType::Void);
        }
        exports.sort_unstable();
        assert_eq!(
            exports,
            ["control", "subject"],
            "{fixture}: both exports remain executable"
        );
    }
}
