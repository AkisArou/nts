//! A null slot removes exactly its old-value load/release. Open entries and
//! every path or call that may write a reference keep that release.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Func, OpKind};
use nts_frontend_ts::Frontend;

fn old_field_releases(func: &Func, parameter: u32) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|id| {
            let OpKind::Release(value) = func.value(**id).kind else {
                return false;
            };
            matches!(func.value(value).kind, OpKind::FieldGet { object, .. }
                if matches!(func.value(object).kind, OpKind::Param(slot) if slot == parameter))
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
    assert_eq!(old_field_releases(find("installClear"), 0), 0);
    for name in ["installMaybe", "installAliased", "aliasParameters"] {
        assert!(
            old_field_releases(find(name), 0) > 0,
            "{name} must give the possibly occupied slot back"
        );
    }
    let entry = find("Published#install");
    let body = prepared
        .entry_decisions
        .iter()
        .find(|decision| {
            decision.kind == hir::own::EntryDecisionKind::Implementation
                && hir::own::source_name(&decision.function) == entry.name
        })
        .map_or(entry, |decision| find(&decision.function));
    assert!(
        old_field_releases(body, 1) > 0,
        "Published#install's node.next (parameter 1) must keep its release for an unknown published caller"
    );
}

fn prepared_memory_case(name: &str) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/memory")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            roots: hir::reachable::Roots::Entry(&["work".into(), "module#init".into()]),
            ..hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Terminal)
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    prepared
}

fn old_cleanup_at(func: &Func, store: hir::ValueId) -> usize {
    let OpKind::FieldSet { object, field, .. } = func.value(store).kind else {
        panic!("the selected operation must store a field");
    };
    func.blocks
        .iter()
        .map(|block| {
            let Some(at) = block.ops.iter().position(|id| *id == store) else {
                return 0;
            };
            block.ops[at + 1..]
                .iter()
                .filter(|id| {
                    let OpKind::Release(old) = func.value(**id).kind else {
                        return false;
                    };
                    block.ops[..at].contains(&old)
                        && matches!(func.value(old).kind,
                            OpKind::FieldGet { object: base, field: slot }
                            if base == object && slot == field)
                })
                .count()
        })
        .sum()
}

fn reference_stores(func: &Func) -> Vec<(hir::ValueId, hir::ValueId, hir::ValueId)> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| match func.value(*id).kind {
            OpKind::FieldSet { object, value, .. } if func.value(value).ty.is_counted() => {
                Some((*id, object, value))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn a_phi_swap_keeps_exactly_the_overwritten_originals_release() {
    let prepared = prepared_memory_case("a-phi-swap-keeps-the-overwritten-release");
    let func = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "work")
        .unwrap();
    let cleared: Vec<_> = reference_stores(func)
        .into_iter()
        .filter(|(_, _, value)| matches!(func.value(*value).kind, OpKind::ConstNull))
        .collect();
    assert!(!cleared.is_empty(), "the a.next clear must remain compiled");
    assert_eq!(
        cleared
            .iter()
            .map(|(id, _, _)| old_cleanup_at(func, *id))
            .sum::<usize>(),
        1,
        "a.next must release the reference written through the swapped right"
    );
}

#[test]
fn a_loop_releases_the_previous_object_and_keeps_the_new_slot_empty() {
    let prepared = prepared_memory_case("a-new-allocation-leaves-the-old-alias-occupied");
    let func = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "work")
        .unwrap();
    let stores = reference_stores(func);
    let fresh: Vec<_> = stores
        .iter()
        .filter(|(_, object, value)| {
            matches!(func.value(*object).kind, OpKind::ObjectNew { .. })
                && !matches!(func.value(*value).kind, OpKind::ConstNull)
        })
        .collect();
    assert_eq!(
        fresh.len(),
        1,
        "fresh.next = first must remain a distinct store"
    );
    let (fresh_store, _, first) = *fresh[0];
    assert_eq!(
        old_cleanup_at(func, fresh_store),
        0,
        "fresh.next is newly empty"
    );
    let older: Vec<_> = stores
        .iter()
        .filter(|(_, object, value)| {
            matches!(func.value(*object).kind, OpKind::BlockParam(_))
                && *value != first
                && !matches!(func.value(*value).kind, OpKind::ConstNull)
        })
        .collect();
    assert_eq!(
        older.len(),
        1,
        "previous.next = replacement must remain compiled"
    );
    assert_eq!(
        old_cleanup_at(func, older[0].0),
        1,
        "previous.next keeps its old-value release after the allocation"
    );
}

#[test]
fn a_branch_join_with_an_occupied_older_alias_keeps_one_release() {
    let prepared = prepared_memory_case("a-branch-allocation-meets-an-older-alias");
    let func = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "exercise")
        .unwrap();
    let joined: Vec<_> = reference_stores(func)
        .into_iter()
        .filter(|(_, object, value)| {
            matches!(func.value(*object).kind, OpKind::BlockParam(_))
                && matches!(func.value(*value).kind, OpKind::ConstNull)
        })
        .collect();
    assert_eq!(
        joined.len(),
        1,
        "the chosen.next clear must remain at the join"
    );
    assert_eq!(
        old_cleanup_at(func, joined[0].0),
        1,
        "one occupied predecessor requires chosen.next's release"
    );
}
