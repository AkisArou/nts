//! `async` methods, refused for a reason that had stopped being true.
//!
//! > `Promise<T>` has no representation, so an `async` method resolved to
//! > `-> void` and returned an `f64` from it anyway.
//!
//! `ManagedType::Promise` has existed for some time and `async` *functions*
//! have worked throughout. Only the method lowering never got the prologue
//! that allocates the promise — 161 occurrences at 63 distinct sites in
//! `runtime/node`, the largest single language refusal there.
//!
//! What the tests are about is the one thing a method has that a function does
//! not: a receiver. It is a parameter, so it goes into the suspended frame
//! beside the others and comes back out on resumption — and a frame that lost
//! it would read `this` off whatever the slot held.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, ManagedType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// The program as `lower` and `hir::suspend` leave it.
///
/// The resumptions do not exist until that pass has run, and they are the
/// subject: an `async` method is two functions and a frame.
fn machine(name: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let mut lowered = hir::lower::lower(&snapshot);
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
        "nothing in examples/async-methods is refused",
    );
    let refusals = hir::suspend::transform(&mut lowered.program);
    assert!(refusals.is_empty(), "and nothing is refused by the split");
    Some(lowered.program)
}

fn layout<'a>(program: &'a hir::Program, name: &str) -> &'a hir::Layout {
    program
        .layouts
        .iter()
        .find(|layout| layout.name == name)
        .unwrap_or_else(|| panic!("`{name}` should be a layout"))
}

/// An `async` method allocates its promise once, before the body.
///
/// The same prologue an `async` function gets, and for the same two reasons:
/// every `return` needs a promise to settle, and the allocation belongs on the
/// one path in rather than on each path out.
#[test]
fn an_async_method_allocates_its_promise_once() {
    let Some(program) = machine("async-methods") else {
        return;
    };
    let entry = program
        .funcs
        .iter()
        .find(|func| func.name == "Counter#scaled")
        .expect("the entry keeps the method's name");
    let allocations = entry
        .values
        .iter()
        .filter(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == "nts_promise_new"
            )
        })
        .count();
    assert_eq!(allocations, 1, "one promise, on the way in");
}

/// Falling off the end settles the promise with `undefined`.
///
/// `record` is `async` and returns `Promise<void>`, so its body ends without a
/// `return` — and the promise still has to settle, because a caller is awaiting
/// it. An `async` function has done this since it existed; a method reached the
/// `close_body` path instead, which terminates a *plain* function and leaves
/// the promise pending for ever.
///
/// The mutation that skips the settle is caught by **17 differential cases and
/// no test**, which is why this exists. A pending promise is not a wrong
/// answer, it is no answer, and the shapes of those two failures are different
/// enough that one instrument sees each.
#[test]
fn falling_off_the_end_settles_the_promise() {
    let Some(program) = machine("async-methods") else {
        return;
    };
    let entry = program
        .funcs
        .iter()
        .find(|func| func.name == "Counter#record")
        .expect("an `async` method returning void");
    let settles = entry
        .values
        .iter()
        .filter(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(name), .. }
                    if name.starts_with("nts_promise_fulfill")
            )
        })
        .count();
    assert!(
        settles >= 1,
        "the fall-through path settles: {:?}",
        entry
            .values
            .iter()
            .filter_map(|op| match &op.kind {
                OpKind::Call { callee: Callee::External(name), .. } => Some(name.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>(),
    );
}

/// The receiver is in the frame, because it is a parameter.
///
/// `afterASuspension` reads `this.base` *after* an `await`, so the receiver has
/// to survive the suspension. A frame without it would resume and read `this`
/// off whatever the slot held — which is not a crash on this lane, because a
/// zeroed slot is a valid-looking pointer to nothing.
#[test]
fn the_receiver_is_in_the_frame() {
    let Some(program) = machine("async-methods") else {
        return;
    };
    let frame = layout(&program, "Counter#afterASuspension#frame");
    let names: Vec<&str> = frame
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect();
    assert_eq!(
        &names[..3],
        &["state", "result", "awaited"],
        "the three fixed fields come first",
    );
    assert!(
        frame.fields.iter().skip(3).any(|field| matches!(
            field.ty,
            hir::HirType::Managed(ManagedType::Object(_))
        )),
        "and the receiver is a parameter field among the rest: {names:?}",
    );
}

/// A `static` async method has no receiver, and its frame does not invent one.
///
/// The other half of the parameter question. `Statics.viaAnother` takes one
/// number, so its frame holds the three fixed fields and exactly one parameter
/// — a fourth would mean the receiver had been counted for a method that has
/// none, which is the mirror of losing it for one that does.
///
/// `viaAnother` rather than `doubled` because only it *awaits*: a body with no
/// suspension keeps its promise prologue and is never split, so it has no frame
/// to ask about. The first version of this test asked for `doubled#frame` and
/// failed on a method that was working perfectly.
///
/// And the name is `Statics.viaAnother`, with a dot: a static method is a
/// namespaced function rather than a member, so it does not take the `#` an
/// instance method's name does. That distinction is `lower_method`'s and this
/// is the only test that depends on it.
#[test]
fn a_static_async_method_has_no_receiver_in_its_frame() {
    let Some(program) = machine("async-methods") else {
        return;
    };
    let frame = layout(&program, "Statics.viaAnother#frame");
    assert_eq!(
        frame.fields.len(),
        4,
        "state, result, awaited, and the one declared parameter: {:?}",
        frame
            .fields
            .iter()
            .map(|field| field.name.as_str())
            .collect::<Vec<_>>(),
    );
}

/// An overridden `async` method is two state machines, not one.
///
/// `Base#describe` and `Derived#describe` each become an entry and a
/// resumption, and the dispatch slot holds the two entries. A split that
/// produced one would give every receiver the same body.
#[test]
fn an_overridden_async_method_is_two_state_machines() {
    let Some(program) = machine("async-methods") else {
        return;
    };
    for name in [
        "Base#describe",
        "Base#describe__resume",
        "Derived#describe",
        "Derived#describe__resume",
    ] {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "`{name}` should exist",
        );
    }
}
