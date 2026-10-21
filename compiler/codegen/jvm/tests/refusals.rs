//! Refusals with a producer, because a branch nobody watches fire is a claim.
//!
//! The backend's `NTS4xxx` codes divide in two. Most are emitter-failure paths
//! -- "the program class could not be written: {error}" -- which are internal
//! invariants and are correctly untested: reaching one means the `Code` builder
//! broke, and a test would have to break it.
//!
//! The rest are reachable from legal TypeScript, and **those had no producer at
//! all**. `NTS4013` appears in the tree exactly twice outside its own source: in
//! `benchmarks/jvm-rows.md`, which is a corpus log. Its comment in `lib.rs` says
//! the shape "has never occurred outside the test that found it", and that test
//! is not in the tree -- so the sentence reads as coverage and is a record of a
//! sweep that happened once.
//!
//! **What sabotage showed, and it is not what the comment implies.** Deleting
//! the check does *not* produce a bad class: the emitter's own member accounting
//! catches it one layer down, as `NTS4004 ... declares the field `a$bD` twice,
//! which the JVM refuses at load as a duplicate member`. So this is defence in
//! depth, and `NTS4013` earns its place by the *message* rather than by being
//! the only thing standing there -- it names the two TypeScript properties and
//! the JVM field they collide on, where the emitter can only name the field.
//! `a$bD` includes the descriptor, which is a name the author never wrote.
//!
//! That is worth knowing before anyone simplifies: removing this refusal costs
//! a diagnosis, not a correctness guarantee. Its comment says the JVM "refuses
//! that at load", which is true and reads as though nothing else would stop it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::PathBuf;

mod common;

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Emit the refusals fixture and return every diagnostic the backend produced.
fn declined() -> Vec<(String, String)> {
    // **Found the way the frontend's own tests find it, and not skipped when
    // absent.** This read `NTS_TSGO` alone and returned `ok` without it, so a
    // bare `cargo test --workspace` -- the run everyone makes by habit -- never
    // ran it: on 2026-09-30 a signature spelled `Erased-Callable` refused four
    // callbacks here while six landings in a row read the suite as green. A
    // check that passes by not running is the failure it exists to prevent.
    let tsgo = nts_frontend_ts::tsgo::locate().unwrap_or_else(|| {
        panic!("no tsgo: set NTS_TSGO or build target/tsgo (tooling/bootstrap/bootstrap.sh)")
    });
    let tsconfig = Utf8PathBuf::from_path_buf(
        repository()
            .join("compiler/codegen/jvm/tests/refusals/tsconfig.json")
            .canonicalize()
            .expect("the fixture is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot");
    // **The fixture must typecheck.** Every shape in it is legal TypeScript that
    // this backend declines; one that failed the checker would be refused a
    // stage earlier and would test the checker instead.
    assert!(
        !snapshot.has_errors(),
        "the refusals fixture should typecheck"
    );

    let prepared = common::prepare(&snapshot).expect("prepared HIR should verify");

    nts_codegen_jvm::emit(&prepared.program)
        .diagnostics
        .iter()
        .map(|it| (it.code.clone(), it.message.clone()))
        .collect()
}

#[test]
fn two_properties_that_become_one_jvm_field_are_refused_by_name() {
    let diagnostics = declined();

    let found = diagnostics.iter().find(|(code, _)| code == "NTS4013");
    let Some((_, message)) = found else {
        panic!(
            "NTS4013 was not produced by a fixture written to produce it; \
             the backend said: {diagnostics:?}"
        );
    };

    // The message names **both** properties and the field they collide on.
    // Naming one of the two would leave a reader hunting for the other, and the
    // whole value of this refusal over `ClassFormatError` is that it says which
    // two lines of their program disagree.
    assert!(
        message.contains("`a-b`"),
        "names the first property: {message}"
    );
    assert!(
        message.contains("`a$b_1`"),
        "names the second property and the field they collide on: {message}"
    );
    // The control: two properties of one spelling, and nothing else, now load
    // as `a$b` and `a$b_1` -- C's rule, `hierarchy::field_name`.
    assert!(
        !diagnostics
            .iter()
            .any(|(code, message)| code == "NTS4013" && message.contains("Spelled")),
        "two properties of one spelling are told apart by index: {diagnostics:?}"
    );
}

/// An interface carrying state, implemented without extending and dispatched
/// through, **now compiles** rather than refusing.
///
/// It was a wrong answer first -- a `checkcast` to the face's class that
/// compiled, loaded, and threw `ClassCastException` -- and then a refusal by
/// name, because a face that carries state was a JVM class its implementers did
/// not extend. A split face (`split_faces`) is referred to as an interface they
/// implement, so `dispatchThrough` has a spelling. Whether it answers as node
/// does is the examples' to say:
/// `a-face-with-a-field-a-class-implements-without-extending` dispatches and
/// writes through one on every case.
#[test]
fn an_interface_that_carries_state_compiles_through_its_interface() {
    let diagnostics = declined();
    assert!(
        !diagnostics
            .iter()
            .any(|(_, message)| message.contains("(in `dispatchThrough`)")),
        "`dispatchThrough` compiles: {diagnostics:?}"
    );
}

#[test]
fn stateful_literal_container_contracts_are_refused_before_a_runtime_cast() {
    let diagnostics = declined();
    for function in [
        "literal", "index", "push", "unshift", "fill", "concat", "map", "set", "promise",
    ] {
        assert!(
            diagnostics.iter().any(|(code, message)| code == "NTS4001"
                && message.contains("`Sink` carries state")
                && message.contains(&format!("(in `{function}"))),
            "{function} should name the incompatible stateful contract: {diagnostics:?}"
        );
    }
}
