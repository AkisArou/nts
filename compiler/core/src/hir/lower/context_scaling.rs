//! Work guard for the fresh 64/256/1024 shared-module populations. The unit is
//! one builder binding plus the constant-table rows physically copied into it;
//! this is a copy-work bound, not a claim about all compiler instructions.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;
use std::{borrow::Borrow, cell::Cell};

pub(super) mod family;

thread_local! {
    static OBSERVE: Cell<bool> = const { Cell::new(false) };
    static BINDINGS: Cell<usize> = const { Cell::new(0) };
    static COPIED_ROWS: Cell<usize> = const { Cell::new(0) };
    static CONTEXTS: Cell<usize> = const { Cell::new(0) };
}

pub(super) fn context() {
    if OBSERVE.with(Cell::get) {
        CONTEXTS.with(|n| n.set(n.get() + 1));
    }
}

fn module_context(context: &impl Borrow<ModuleScope>) -> &ModuleScope {
    context.borrow()
}

pub(super) fn binding(shared: &Shared, builder: &FuncBuilder<'_>) {
    if !OBSERVE.with(Cell::get) {
        return;
    }
    BINDINGS.with(|n| n.set(n.get() + 1));
    // Coercion to references works for both the old owned builder context and
    // the borrowed one. Identity detects a real copy; empty-table coincidence
    // cannot turn a nonempty copied table into zero work.
    let original: &ModuleScope = &shared.module;
    let bound = module_context(&builder.module);
    if !std::ptr::eq(original, bound) {
        COPIED_ROWS.with(|n| n.set(n.get() + bound.constants.len()));
    }
}

fn assert_family(program: &crate::hir::Program, calls: family::Calls, count: usize) {
    assert!(
        program.refused_bodies().next().is_none(),
        "fresh family must lower"
    );
    let exported: Vec<_> = program
        .funcs
        .iter()
        .filter(|f| {
            f.exported
                && f.name
                    .strip_prefix('f')
                    .is_some_and(|index| index.parse::<usize>().is_ok_and(|at| at < count))
        })
        .collect();
    assert_eq!(exported.len(), count, "all generated exports stay live");
    let actual_calls = exported
        .iter()
        .flat_map(|f| &f.values)
        .filter(|v| match (&v.kind, calls) {
            (
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                },
                family::Calls::WrittenDirect,
            ) => name == "f0",
            (
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                },
                family::Calls::RuntimeDirect,
            ) => name == "nts_math_sin",
            _ => false,
        })
        .count();
    let expected = match calls {
        family::Calls::WrittenDirect => count - 1,
        family::Calls::RuntimeDirect => count,
    };
    assert_eq!(
        actual_calls, expected,
        "family labels follow actual HIR callees"
    );
}

#[test]
fn fresh_shared_context_copy_work_grows_linearly() {
    let repository = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut reports = Vec::new();
    for calls in family::Calls::ALL {
        for count in family::COUNTS {
            let dir = crate::scratch::StdScratchDir::path_in_std_target(&format!(
                "nts-context102-{}-{count}",
                calls.name()
            ));
            calls.write(&dir, count, repository.as_std_path()).unwrap();
            let mut frontend = nts_frontend_ts::Frontend::new(&repository)
                .with_checkers(std::num::NonZeroU16::MIN);
            let semantic = frontend
                .snapshot(camino::Utf8Path::from_path(&dir.join("tsconfig.json")).unwrap())
                .unwrap();
            assert!(!semantic.has_errors(), "fresh family must typecheck");
            BINDINGS.with(|n| n.set(0));
            COPIED_ROWS.with(|n| n.set(0));
            CONTEXTS.with(|n| n.set(0));
            OBSERVE.with(|n| n.set(true));
            let lowered = super::lower(&semantic);
            OBSERVE.with(|n| n.set(false));
            assert_family(&lowered.program, calls, count);
            let contexts = CONTEXTS.with(Cell::get);
            let bindings = BINDINGS.with(Cell::get);
            let copied = COPIED_ROWS.with(Cell::get);
            let work = bindings + copied;
            eprintln!(
                "fresh {} N={count}: contexts={contexts}, bindings={bindings}, copied constant rows={copied}, copy-work units={work}",
                calls.name()
            );
            reports.push((calls.name(), count, contexts, copied, work));
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
    let mut previous = None;
    for (name, count, contexts, copied, work) in reports {
        assert!(
            work <= 16 * count,
            "{name} N={count}: {work} copy-work units"
        );
        if let Some((before_name, before)) = previous
            && before_name == name
        {
            assert!(
                work <= 5 * before,
                "fourfold input must grow at most linearly"
            );
        }
        assert_eq!(contexts, 1, "one immutable program context");
        assert_eq!(copied, 0, "builders borrow the constant table");
        previous = Some((name, work));
    }
}
