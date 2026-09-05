//! Calling a closure a field can hold only one of.
//!
//! A closure call is a dispatch: two dependent loads to reach
//! `descriptor->methods[slot]`, then an indirect call. The loads are the small
//! half; the large half is that no C compiler can see through the indirection,
//! so the callee is not inlined — and closure bodies are usually small enough
//! that not inlining them is most of what they cost.
//!
//! `benches/cases/optional-chain` went **87.98 us to 35.17 us** on this,
//! against a C++ reference at 9.51 that writes a bare function pointer clang
//! devirtualises. The prediction was taken first by patching the one line in the
//! emitted C, at 35.16, which is the number worth trusting.
//!
//! The tests below are mostly about what must **not** be rewritten, because
//! this is a pass whose failure mode is calling the wrong function and being
//! silent about it. Four of the five exports in the fixture are negative.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::SemanticSource;

fn prepared(name: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare_unverified(&snapshot, &hir::Options::default()).program)
}

/// Whether the closure call reachable from this exported function is a dispatch
/// or a direct call, by the name the export was given.
fn calls_directly(program: &hir::Program, export: &str) -> bool {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == export)
        .unwrap_or_else(|| panic!("`{export}` is exported from examples/callback-fields"));
    let mut dispatch = false;
    let mut direct = false;
    for op in &func.values {
        match &op.kind {
            OpKind::Call {
                callee: Callee::Closure { .. },
                ..
            } => dispatch = true,
            OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } if name.contains("#call") => direct = true,
            _ => {}
        }
    }
    assert!(
        dispatch != direct,
        "`{export}` should have exactly one of a dispatch and a direct closure call"
    );
    direct
}

/// A field only one closure is ever stored into is called directly.
///
/// Two shapes, because "one closure" is not the same as "a named function":
/// `capturing` stores an arrow that carries a captured local, which is one
/// closure class like any other and must be rewritten too.
#[test]
fn a_field_that_holds_one_closure_is_called_directly() {
    let Some(program) = prepared("callback-fields") else {
        return;
    };
    assert!(
        calls_directly(&program, "single"),
        "one named function stored into the field"
    );
    assert!(
        calls_directly(&program, "capturing"),
        "a capturing closure is one closure class like any other"
    );
}

/// Everything else stays a dispatch.
///
/// The four ways a field is not one closure, and each is a separate mistake a
/// rule could make: joining two stores into whichever it saw first, treating a
/// parameter as though its value were visible, answering for a field nothing
/// ever stored into, and — the one that is silent — treating an *unknown* store
/// as though it were an absent one, which leaves the one known closure looking
/// like the only one the field can hold.
#[test]
fn a_field_that_may_hold_several_is_not_rewritten() {
    let Some(program) = prepared("callback-fields") else {
        return;
    };
    for export in [
        "eitherOf",
        "throughAParameter",
        "neverInstalled",
        "mixedSources",
    ] {
        assert!(
            !calls_directly(&program, export),
            "`{export}` does not name one closure and must stay a dispatch"
        );
    }
}

/// The IR states the narrowing rather than leaving a backend to invent it.
///
/// The receiver's static type is the *signature* layout and the function it now
/// calls declares its own class. C casts a pointer for free; the JVM will not,
/// and said so — `NTS4001 storing a Fn5__5 where a Closure0 is declared`. So the
/// `Unerase` the receiver comes from is read back at the class the field can
/// only hold, which is a fact the analysis proved rather than one a backend
/// guessed.
#[test]
fn the_receiver_is_unerased_to_the_class_it_is_called_as() {
    let Some(program) = prepared("callback-fields") else {
        return;
    };
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == "single")
        .expect("`single` is exported");
    let (name, receiver) = func
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if name.contains("#call") => Some((name.clone(), *args.first()?)),
            _ => None,
        })
        .expect("`single` calls its callback directly");

    let receiver = &func.values[receiver.0 as usize];
    assert!(
        matches!(receiver.kind, OpKind::Unerase { .. }),
        "the receiver is read out of an erased field"
    );
    let HirType::Managed(ManagedType::Object(class)) = receiver.ty else {
        panic!("the receiver is an object, not {:?}", receiver.ty);
    };
    assert!(
        hir::is_closure_type(class),
        "read back at a closure's class rather than at the signature layout"
    );
    // And the class it is read back at is the one whose function is called.
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(&class))
        .expect("the class has a layout");
    assert!(
        layout.methods.iter().flatten().any(|method| method == &name),
        "`{name}` is {}'s own implementation, not another class's",
        layout.name
    );
}
