//! `function*` and `yield`, as the state machine they become.
//!
//! The transformation is the one `async` already had — cut the body at each
//! suspension, spill what is live across one, dispatch on a stored state — and
//! what differs is the protocol. An `await` subscribes to a promise and is
//! resumed by the event loop; a `yield` *returns* to the caller that is
//! standing there, and is resumed when that caller asks for another element.
//!
//! So the tests are about the two halves of that. The generator's own body must
//! become a machine whose suspension is a plain return with the element in the
//! frame; and the `for...of` that walks one must be one call and one load an
//! iteration, with the frame as its whole state.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind, Terminator};
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// The program as `lower` and `hir::suspend` leave it, and no further.
///
/// Unlike every other test in this directory the interesting functions do not
/// exist until that pass has run: `upTo__resume` is built there, and the
/// generator's original body is gone. And unlike the whole pipeline, this stops
/// before the optimizer — which *inlines the generator's entry into its
/// caller*, so `upTo` is not a function at all by the end. That is the right
/// outcome and it is checked separately below; these tests are about what the
/// two passes produce.
fn machine(name: &str) -> Option<hir::Program> {
    let mut lowered = lowered(name)?;
    let refusals = hir::suspend::transform(&mut lowered.program);
    assert!(
        refusals.is_empty(),
        "nothing in examples/generators is refused: {refusals:#?}",
    );
    Some(lowered.program)
}

/// The whole pipeline, for the one claim that is about what survives it.
fn prepared(name: &str) -> Option<hir::Prepared> {
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
    Some(hir::prepare_unverified(&snapshot, &hir::Options::default()))
}

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
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
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(program: &'a hir::Program, name: &str) -> &'a hir::Func {
    program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` should be in the program"))
}

/// A walk over a generator is one call and one load, and allocates nothing.
///
/// The frame is made once, before the loop, by calling the generator — and
/// calling one runs none of its body, so that call is an allocation and a few
/// stores. Everything after it is `resume(frame)` and a field read.
///
/// The number that matters is **zero allocations inside the loop**. An
/// implementation that built a `{ value, done }` per step would agree with node
/// on every case in `examples/generators` and cost an object per element, which
/// is what `Walk::Protocol` does for a user type that hands one back and what
/// this walk exists not to do.
#[test]
fn a_generator_walk_allocates_nothing_per_element() {
    let Some(program) = machine("generators") else {
        return;
    };
    let total = func(&program, "total");
    let allocations = total
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }))
        .count();
    assert_eq!(
        allocations, 0,
        "the walk allocates nothing: the frame is the generator's, made by the call",
    );

    let resumptions = total
        .values
        .iter()
        .filter(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::Direct(name), .. } if name == "upTo__resume"
            )
        })
        .count();
    assert_eq!(
        resumptions, 1,
        "one resumption in the loop, which is both the step and the test",
    );
}

/// The element comes out of the slot the frame calls `yielded`.
///
/// The walk and `hir::suspend` are two passes that have to agree about one
/// offset, and they agreeing is not checkable by *running* the program in one
/// backend: a load of the wrong field is a load, and C has no opinion about it.
///
/// **Written the obvious way, this test cannot fail.** Asserting the read
/// equals `suspend::FIELD_YIELDED` compares the constant with itself — setting
/// it to zero moves the code and the assertion together, and all eight tests
/// here passed with the walk reading the *state* out of the frame. So the
/// expected slot is derived from somewhere else: the layout the pass built,
/// which names its fields.
#[test]
fn the_element_is_read_from_the_frame() {
    let Some(program) = machine("generators") else {
        return;
    };
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.name == "upTo#frame")
        .expect("the frame's layout is built by `hir::suspend`");
    let yielded = layout
        .fields
        .iter()
        .position(|field| field.name == "yielded")
        .expect("a generator's frame holds the element it stopped on");

    let total = func(&program, "total");
    let read: Vec<usize> = total
        .values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::FieldGet { field, .. } => Some(field as usize),
            _ => None,
        })
        .collect();
    assert_eq!(
        read,
        vec![yielded],
        "the body reads exactly the slot the frame calls `yielded`, \
         and nothing else off the frame",
    );
    assert_ne!(
        yielded,
        layout
            .fields
            .iter()
            .position(|field| field.name == "state")
            .expect("a frame holds its state"),
        "the element and the state are different slots",
    );
}

/// The resumption answers *done*, and the loop runs while it is false.
///
/// Both halves are worth pinning because each fails silently in its own way.
/// A resumption returning anything but a `bool` is a walk with no test; a
/// missing `not` is a loop that runs while it is finished, which reads the
/// element slot of a frame that stopped filling it.
#[test]
fn the_resumption_answers_done() {
    let Some(program) = machine("generators") else {
        return;
    };
    let resume = func(&program, "upTo__resume");
    assert_eq!(
        resume.return_type,
        HirType::Bool,
        "the resumption's result is `done`",
    );
    assert_eq!(resume.params.len(), 1, "its one argument is the frame");

    let total = func(&program, "total");
    let stepped = total
        .values
        .iter()
        .position(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::Direct(name), .. } if name == "upTo__resume"
            )
        })
        .expect("the loop resumes the generator");
    let negated = total.values.iter().any(|op| {
        matches!(
            op.kind,
            OpKind::Unary {
                op: hir::UnOp::Not,
                operand,
            } if operand.0 as usize == stepped
        )
    });
    assert!(
        negated,
        "`done` says when to stop, so the loop runs while it is false",
    );
}

/// The generator's own body becomes a machine whose suspension is a return.
///
/// Every `yield` leaves the element in the frame and returns *not done*; every
/// finishing exit returns *done*. So the resumption's returns are all constant
/// booleans, and both values are present — a machine that only ever answered
/// one of them is a loop that never starts or never stops.
#[test]
fn a_yield_is_a_return_with_the_element_in_the_frame() {
    let Some(program) = machine("generators") else {
        return;
    };
    let resume = func(&program, "upTo__resume");
    let mut answered: Vec<bool> = resume
        .blocks
        .iter()
        .filter_map(|block| match block.terminator {
            Terminator::Return(Some(value)) => match resume.values[value.0 as usize].kind {
                OpKind::ConstBool(done) => Some(done),
                _ => None,
            },
            _ => None,
        })
        .collect();
    answered.sort_unstable();
    answered.dedup();
    assert_eq!(
        answered,
        vec![false, true],
        "a `yield` returns not-done and the end returns done",
    );

    // Named through the layout rather than through `FIELD_YIELDED`, for the
    // reason written on the test above: the constant is what is under test, so
    // an assertion spelled with it compares it against itself. The layout's
    // field *names* come from `frame_fields`, which is a different place.
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.name == "upTo#frame")
        .expect("the frame's layout is built by `hir::suspend`");
    let yielded = u32::try_from(
        layout
            .fields
            .iter()
            .position(|field| field.name == "yielded")
            .expect("a generator's frame holds the element it stopped on"),
    )
    .expect("a frame has few enough fields to count");
    let stored: Vec<u32> = resume
        .values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::FieldSet { field, .. } => Some(field),
            _ => None,
        })
        .collect();
    assert!(
        stored.contains(&yielded),
        "the element goes in the slot the frame calls `yielded` before the \
         suspension returns; it wrote {stored:?}",
    );
}

/// What is live across a `yield` is in the frame, and the frame is two fields
/// plus the parameters plus those.
///
/// `strided` holds `at` and `made` across its suspension and neither is a
/// parameter, so both are spilled. The layout is the check: a generator whose
/// frame held only its parameters would resume with whatever the C locals had
/// been left holding, which is a plausible number rather than an obvious one.
#[test]
fn the_frame_holds_what_survives_the_suspension() {
    let Some(program) = machine("generators") else {
        return;
    };
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.name == "strided#frame")
        .expect("the frame's layout is built by `hir::suspend`");
    let names: Vec<&str> = layout
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect();
    assert_eq!(
        &names[..5],
        &["state", "yielded", "from", "step", "count"],
        "the two fixed fields, then the parameters in order",
    );
    assert!(
        names.len() > 5,
        "`at` and `made` are live across the yield and are not parameters, \
         so the frame has slots for them: {names:?}",
    );
}

/// A generator's frame is not a promise frame, and the two spaces do not meet.
#[test]
fn a_generator_frame_is_its_own_kind_of_synthetic_type() {
    let Some(program) = machine("generators") else {
        return;
    };
    let upto = func(&program, "upTo");
    let HirType::Managed(ManagedType::Object(ty)) = upto.return_type else {
        panic!("calling a generator produces its frame");
    };
    assert!(
        ty.0 >= hir::SYNTHETIC_GENERATOR_FRAMES && ty.0 < hir::SYNTHETIC_CLOSURES,
        "a generator's frame is in the generators' half of the frame space",
    );
}

/// One frame per walk survives the whole pipeline — and only one.
///
/// The optimizer **inlines the generator's entry** into its caller, which is
/// why `upTo` is not a function by the end: calling a generator is an
/// allocation and a few stores, and there is nothing else in it to call. So the
/// allocation moves into `total`, where it belongs, and the number to hold is
/// that there is exactly one of it — a walk of a thousand elements allocates
/// once.
///
/// This is the claim the pass-level tests cannot make, because the passes have
/// not run; and it is the one that would break silently if a later change made
/// the resumption allocate, since the answers would stay right either way.
#[test]
fn a_walk_of_any_length_allocates_once() {
    let Some(prepared) = prepared("generators") else {
        return;
    };
    let total = func(&prepared.program, "total");
    let allocations = total
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }))
        .count();
    assert_eq!(
        allocations, 1,
        "the frame, once, for however many elements come out of it",
    );
    let resume = func(&prepared.program, "upTo__resume");
    let inside = resume
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }))
        .count();
    assert_eq!(inside, 0, "and the resumption allocates nothing at all");
}

/// The four things a generator is refused for, each by name.
///
/// The fourth is **iterator closing** and it is the one that was a wrong answer
/// rather than a missing one: a `for...of` left by `break` calls `gen.return()`
/// on the way out, which runs the generator's `finally`. A generator whose
/// `finally` incremented a counter disagreed with node on **26 of 29 cases**
/// before this was refused.
///
/// Every one of them is a wrong answer rather than a missing convenience, which
/// is why they are refusals and not approximations:
///
/// - `yield*` is an unbounded number of inner steps behind one outer `next`.
/// - the **value** of a `yield` is what the caller passed to `next(v)`, and a
///   `for...of` passes nothing — answering `undefined` to a program that
///   expects a conversation is not the same as not having one.
/// - a generator reaching a loop as a **parameter** has no call behind it to
///   take the resumption's name from. It is refused one step earlier than that,
///   at the parameter, because a `Generator<T, ...>` has no representation to
///   be a parameter *of* — the frame is what a call produces, and a signature
///   written in the source cannot name one. Both refusals are right and the
///   earlier one is better: it names the declaration rather than the loop.
/// - an `async` generator speaks both protocols at once.
#[test]
fn what_a_generator_is_refused_for() {
    let Some(lowered) = lowered("generator-unsupported") else {
        return;
    };
    let said: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    for wanted in [
        "a `yield*` is not supported by this lowering yet",
        "the value of a `yield` is not supported by this lowering yet",
        "a parameter of unrepresentable type (`Generator`) is not supported by this \
         lowering yet",
        "a `finally` that spans a `yield`, which is iterator closing is not supported by \
         this lowering yet",
    ] {
        assert!(
            said.contains(&wanted),
            "expected `{wanted}` among {said:#?}",
        );
    }
}
