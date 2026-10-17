//! Comparator calls use one ABI during lowering, then recover a direct body
//! only after argument admission is proved. A handled throw must still reach
//! the raising entry selected by the closure's table.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

const EXAMPLE: &str = "a-throwing-sort-comparator-inside-a-try";

fn programs() -> Option<(hir::lower::Lowered, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(EXAMPLE)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{EXAMPLE} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let lowered = hir::lower::lower(&snapshot);
    let prepared = hir::prepare(&snapshot).expect("prepared HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    Some((lowered, prepared))
}

#[derive(Debug, PartialEq, Eq)]
enum Reached {
    Slot(u32),
    Name(String),
}

fn function<'a>(program: &'a hir::Program, name: &str) -> &'a hir::Func {
    program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .expect("function retained")
}

fn closure_calls_in(program: &hir::Program, name: &str) -> Vec<Reached> {
    let func = function(program, name);
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| match &func.values[id.0 as usize].kind {
            hir::OpKind::Call {
                callee: hir::Callee::Closure { slot },
                ..
            } => Some(Reached::Slot(*slot)),
            hir::OpKind::Call {
                callee: hir::Callee::Direct(called),
                ..
            } if called.starts_with("Closure") => Some(Reached::Name(called.clone())),
            _ => None,
        })
        .collect()
}

/// Read the selected entry from the prepared descriptor, independently of its
/// spelling. Lowering's receiver is the concrete closure in this fixture.
fn selected_entry(raw: &hir::Program, prepared: &hir::Program, name: &str) -> String {
    let func = function(raw, name);
    func.values
        .iter()
        .find_map(|op| {
            let hir::OpKind::Call {
                callee: hir::Callee::Closure { slot },
                args,
                ..
            } = &op.kind
            else {
                return None;
            };
            let hir::HirType::Managed(hir::ManagedType::Object(class)) =
                func.values[args[0].0 as usize].ty
            else {
                return None;
            };
            prepared
                .layouts
                .iter()
                .find(|layout| layout.types.contains(&class))
                .and_then(|layout| layout.methods.get(*slot as usize))
                .and_then(Clone::clone)
        })
        .expect("the comparator has its selected entry")
}

#[test]
fn a_guarded_comparator_keeps_its_raising_entry_and_the_control_recovers_its_body() {
    let Some((lowered, prepared)) = programs() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    let raw = &lowered.program;
    let raising = raw.raising_call_slot.expect("raising entry");
    let ordinary = raw.erased_call_slot.expect("ordinary entry");
    assert_ne!(raising, ordinary);
    for guarded in [
        "directlyAroundTheSort",
        "withAQuietComparator",
        "Jar#smallest@raises",
    ] {
        assert_eq!(
            closure_calls_in(raw, guarded),
            vec![Reached::Slot(raising)],
            "{guarded}"
        );
        assert_eq!(
            closure_calls_in(&prepared.program, guarded),
            vec![Reached::Name(selected_entry(
                raw,
                &prepared.program,
                guarded
            ))],
            "{guarded} must call the selected raising-slot target"
        );
    }
    for unguarded in ["outsideATry", "Jar#smallest"] {
        assert_eq!(
            closure_calls_in(raw, unguarded),
            vec![Reached::Slot(ordinary)],
            "{unguarded} starts in the uniform ABI too"
        );
    }
    let calls = closure_calls_in(&prepared.program, "outsideATry");
    assert!(
        matches!(calls.as_slice(), [Reached::Name(name)] if name.ends_with("#call")),
        "the ordinary control must recover its typed body: {calls:?}"
    );
    let outside = function(&prepared.program, "outsideATry");
    assert!(
        outside
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .all(|id| !matches!(
                outside.values[id.0 as usize].kind,
                hir::OpKind::Erase { .. } | hir::OpKind::TagOf { .. }
            )),
        "the ordinary control must retain no argument erasure or admission check"
    );
}
