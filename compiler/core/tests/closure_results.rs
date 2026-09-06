//! A call whose result is itself a function needs that signature to have a class.
//!
//! Declaring such a field was fine and building one was fine; calling it was
//! not. The result's type is a signature, and until something called it nothing
//! had needed that signature to have a layout — so the value existed with a
//! type no layout answered for, and the backend refused the whole function
//! with `NTS2006 an object type with no layout`: a message about a type rather
//! than about the call that made it.
//!
//! Asked here rather than through `examples/`, because an example is a claim on
//! every backend at once and the JVM lane cannot dispatch this shape yet. What
//! is lane-independent is the question this file asks: after lowering, does the
//! returned signature have a layout?
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/closure-results/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// Every closure call's result type has a layout, and one of them is a function.
#[test]
fn a_returned_signature_has_a_class() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "the fixture lowers without refusals: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );

    // The results of closure calls, which is where the missing layout was.
    let mut returned_functions = 0usize;
    for func in &lowered.program.funcs {
        for op in &func.values {
            if !matches!(op.kind, OpKind::Call { .. }) {
                continue;
            }
            let HirType::Managed(ManagedType::Object(ty)) = op.ty else {
                continue;
            };
            // A synthetic closure class is its own layout by construction; what
            // this is about is a *declared* signature reached as a call result.
            if hir::is_closure_type(ty) {
                continue;
            }
            let has_layout = lowered
                .program
                .layouts
                .iter()
                .any(|layout| layout.types.contains(&ty));
            assert!(
                has_layout,
                "the result of a call has no layout: {ty:?} in `{}`",
                func.name
            );
            returned_functions += 1;
        }
    }
    assert!(
        returned_functions > 0,
        "the fixture is supposed to contain calls returning objects; \
         if this fires the test is measuring nothing",
    );
}
