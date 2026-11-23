//! Publication borrows; direct calls hand a reference to the one stored body.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Func, OpKind};
use nts_frontend_ts::Frontend;

fn prepared(provider: hir::Memory) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-direct-call-hands-an-argument-to-a-published-method/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
            ..hir::Options::new(nts_core::hir::backend::Backend::C)
        },
    )
    .unwrap()
}

fn operations(func: &Func) -> impl Iterator<Item = &OpKind> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &func.value(*id).kind)
}

fn argument_counts(func: &Func, target: &str) -> (usize, usize) {
    let argument = operations(func)
        .find_map(|op| match op {
            OpKind::Call {
                callee: Callee::Direct(callee),
                args,
                ..
            } if callee == target => args.first().copied(),
            _ => None,
        })
        .unwrap();
    let retained = operations(func)
        .filter(|op| matches!(op, OpKind::Retain(value) if *value == argument))
        .count();
    let released = operations(func)
        .filter(|op| matches!(op, OpKind::Release(value) if *value == argument))
        .count();
    (retained, released)
}

#[test]
fn published_entries_borrow_and_direct_calls_consume_the_single_body() {
    let prepared = prepared(hir::Memory::ReferenceCounting);
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    let program = &prepared.program;
    let find = |name: &str| program.funcs.iter().find(|func| func.name == name).unwrap();
    let summaries = hir::own::summarize(program, &program.layouts);
    assert!(summaries.consumes("publish").is_none());
    assert!(
        summaries
            .consumes("@consuming:publish")
            .unwrap()
            .contains(&0)
    );
    let entry = find("publish");
    assert_eq!(
        operations(entry)
            .filter(|op| matches!(op, OpKind::Call { .. }))
            .count(),
        1
    );
    assert!(!operations(entry).any(|op| matches!(op, OpKind::GlobalSet { .. })));
    assert_eq!(
        operations(entry)
            .filter(|op| matches!(op, OpKind::Retain(_)))
            .count(),
        1
    );
    assert_eq!(
        operations(entry)
            .filter(|op| matches!(op, OpKind::Release(_)))
            .count(),
        0
    );
    assert!(
        operations(find("@consuming:publish")).any(|op| matches!(op, OpKind::GlobalSet { .. }))
    );
    assert!(!operations(find("@consuming:publish")).any(|op| matches!(op, OpKind::Retain(_))));
    for name in ["direct", "stillUsed"] {
        assert!(
            operations(find(name)).any(|op| matches!(op,
            OpKind::Call { callee: Callee::Direct(target), .. } if target == "@consuming:publish"))
        );
        assert_eq!(
            argument_counts(find(name), "@consuming:publish"),
            if name == "direct" { (0, 0) } else { (1, 1) },
            "{name}: a dying argument moves; a later use needs a caller-owned reference"
        );
    }
    assert!(
        !program
            .funcs
            .iter()
            .any(|func| func.name == "@consuming:onlyPublished")
    );
    assert!(
        !program
            .funcs
            .iter()
            .any(|func| func.name.starts_with("@consuming:") && func.name.ends_with("#whole")),
        "a guarded specialization has no borrowed caller"
    );
    assert!(
        !program
            .funcs
            .iter()
            .any(|func| func.name.starts_with("@consuming:") && func.name.contains("#constructor"))
    );
    for layout in &program.layouts {
        assert!(
            layout
                .methods
                .iter()
                .flatten()
                .all(|name| !name.starts_with("@consuming:"))
        );
    }
}

#[test]
fn recursive_direct_calls_use_the_same_consuming_body() {
    let prepared = prepared(hir::Memory::ReferenceCounting);
    let body = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "@consuming:recurse")
        .unwrap();
    assert!(operations(body).any(|op| matches!(op,
        OpKind::Call { callee: Callee::Direct(target), .. } if target == "@consuming:recurse")));
    assert!(!operations(body).any(|op| matches!(op,
        OpKind::Call { callee: Callee::Direct(target), .. } if target == "recurse")));
}

#[test]
fn a_storage_permission_moves_to_the_body_and_leaves_the_adapter() {
    let before = prepared(hir::Memory::NoGc).program;
    let after = prepared(hir::Memory::ReferenceCounting).program;
    let moved: Vec<_> = before
        .interface_access
        .storage_bodies
        .iter()
        .filter(|(name, _)| {
            after
                .funcs
                .iter()
                .any(|func| func.name == format!("@consuming:{name}"))
        })
        .collect();
    assert_ne!(
        moved.len(),
        0,
        "the interface setter exercises body-owned authority"
    );
    for (name, owner) in moved {
        assert!(!after.interface_access.storage_bodies.contains_key(name));
        assert_eq!(
            after
                .interface_access
                .storage_bodies
                .get(&format!("@consuming:{name}")),
            Some(owner)
        );
        assert!(after.dispatch_targets().any(|target| target == name));
    }
}

#[test]
fn the_body_is_moved_without_copying_or_changing_its_signature() {
    let before = prepared(hir::Memory::NoGc).program;
    let after = prepared(hir::Memory::ReferenceCounting).program;
    for body in after
        .funcs
        .iter()
        .filter(|func| func.name.starts_with("@consuming:"))
    {
        let name = body.name.strip_prefix("@consuming:").unwrap();
        let original = before.funcs.iter().find(|func| func.name == name).unwrap();
        let entry = after.funcs.iter().find(|func| func.name == name).unwrap();
        assert_eq!(body.params.len(), original.params.len());
        assert_eq!(body.return_type, original.return_type);
        assert_eq!(entry.params.len(), original.params.len());
        for (actual, expected) in entry.params.iter().zip(&original.params) {
            assert_eq!(actual.ty, expected.ty);
            assert_eq!(actual.shape, expected.shape);
        }
        assert_eq!(
            operations(body)
                .filter(|op| matches!(op, OpKind::GlobalSet { .. } | OpKind::FieldSet { .. }))
                .count(),
            operations(original)
                .filter(|op| matches!(op, OpKind::GlobalSet { .. } | OpKind::FieldSet { .. }))
                .count()
        );
        assert!(
            !operations(entry)
                .any(|op| matches!(op, OpKind::GlobalSet { .. } | OpKind::FieldSet { .. }))
        );
    }
}

#[test]
fn only_a_resumable_product_withholds_an_unsafe_consuming_answer() {
    use hir::reachable::Roots;

    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/resumable-consuming/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let entries = vec!["work".to_owned(), "module#init".to_owned()];
    let declared = vec![
        "published".to_owned(),
        "work".to_owned(),
        "read".to_owned(),
        "module#init".to_owned(),
    ];
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::NoGc,
            roots: Roots::EntrySurface,
            ..hir::Options::new(nts_core::hir::backend::Backend::C)
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    let mut program = prepared.program;
    let relay = program
        .funcs
        .iter()
        .find(|func| func.name == "relayThrow")
        .unwrap();
    assert!(operations(relay).any(|op| matches!(op,
        OpKind::Call { callee: Callee::Direct(target), .. }
            if target == "nestedThrow")));
    // Ask the ownership owner about one unchanged open IR. Preparing each
    // product separately can specialize away the very raising edge at issue.
    for (roots, resumable) in [
        (Roots::Entry(&entries), false),
        (Roots::EveryExport, true),
        (Roots::EntrySurface, true),
        (Roots::Declared(&declared), true),
    ] {
        program.roots = Some(roots.to_owned());
        assert_eq!(
            hir::reachable::host_may_reenter_after_uncaught(&program),
            resumable
        );
        let summaries = hir::own::summarize(&program, &program.layouts);
        for (name, expected, helper) in [
            ("storeAfterRelay", !resumable, "relayThrow"),
            ("storeAfterQuietRead", true, "quietRead"),
        ] {
            assert!(
                program.funcs.iter().any(|func| func.name == name),
                "{roots:?}: {name}"
            );
            let body = program.funcs.iter().find(|func| func.name == name).unwrap();
            let placed = operations(body).collect::<Vec<_>>();
            let call = placed
                .iter()
                .position(|op| {
                    matches!(op,
                    OpKind::Call { callee: Callee::Direct(target), .. }
                        if target == helper)
                })
                .expect("the helper call must survive preparation");
            let store = placed
                .iter()
                .position(|op| matches!(op, OpKind::GlobalSet { .. }))
                .expect("the consuming store must survive preparation");
            assert!(call < store, "{roots:?}: {name} must call before storing");
            assert_eq!(
                summaries.consumes(name).is_some(),
                expected,
                "{roots:?}: {name}"
            );
        }
    }
}
