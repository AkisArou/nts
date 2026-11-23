//! A null slot removes exactly its old-value load/release. Open entries and
//! every path or call that may write a reference keep that release.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Func, OpKind};
use nts_frontend_ts::Frontend;

fn old_field_releases(func: &Func) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|id| {
            let OpKind::Release(value) = func.value(**id).kind else {
                return false;
            };
            matches!(func.value(value).kind, OpKind::FieldGet { .. })
        })
        .count()
}

#[test]
fn only_a_slot_proved_null_at_every_call_loses_its_old_value_release() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-field-cleared-before-a-call-keeps-no-old-reference/tsconfig.json")
        .canonicalize_utf8().unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Terminal)
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    let find = |name: &str| {
        prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .unwrap_or_else(|| panic!("{name} must remain a compiled control"))
    };
    assert_eq!(old_field_releases(find("installClear")), 0);
    for name in ["installMaybe", "installAliased", "aliasParameters"] {
        assert!(
            old_field_releases(find(name)) > 0,
            "{name} must give the possibly occupied slot back"
        );
    }
    let body = find("@consuming:Published#install");
    assert!(
        old_field_releases(body) > 0,
        "an open borrowed entry passes unknown slot contents to its body"
    );
}
