//! Refusals with a producer, because a branch nobody watches fire is a claim.
//!
//! The backend's `NTS4xxx` codes divide in two. Most are emitter-failure paths
//! -- "the program class could not be written: {error}" -- which are internal
//! invariants and are correctly untested: reaching one means the `Code` builder
//! broke, and a test would have to break it.
//!
//! The rest are reachable from legal TypeScript, and **those had no producer at
//! all**. `NTS4013` appears in the tree exactly twice outside its own source: in
//! `benches/jvm-rows.md`, which is a corpus log. Its comment in `lib.rs` says
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
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::PathBuf;

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Emit the refusals fixture and return every diagnostic the backend produced.
fn declined() -> Option<Vec<(String, String)>> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP refusals: NTS_TSGO is not set");
        return None;
    };
    if !tsgo.exists() {
        eprintln!("SKIP refusals: no tsgo at {tsgo}");
        return None;
    }
    let tsconfig = Utf8PathBuf::from_path_buf(
        repository()
            .join("compiler/codegen/jvm/tests/refusals/tsconfig.json")
            .canonicalize()
            .expect("the fixture is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    // **The fixture must typecheck.** Every shape in it is legal TypeScript that
    // this backend declines; one that failed the checker would be refused a
    // stage earlier and would test the checker instead.
    assert!(!snapshot.has_errors(), "the refusals fixture should typecheck");

    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() },
    )
    .expect("prepared HIR should verify");

    Some(
        nts_codegen_jvm::emit(&prepared.program)
            .diagnostics
            .iter()
            .map(|it| (it.code.clone(), it.message.clone()))
            .collect(),
    )
}

#[test]
fn two_properties_that_become_one_jvm_field_are_refused_by_name() {
    let Some(diagnostics) = declined() else {
        return;
    };

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
    assert!(message.contains("`a b`"), "names the first property: {message}");
    assert!(message.contains("`a-b`"), "names the second property: {message}");
    assert!(message.contains("`a$b`"), "names the JVM field they collide on: {message}");
}

/// An interface carrying state, reached through an erased value.
///
/// **This was a wrong answer rather than a refusal**, which is the worse kind
/// and the reason it survived: a program that compiles, loads, and throws
/// `ClassCastException` is invisible to every refusal count in the tree. It took
/// an example that dispatches *through* an interface type to surface it -- other
/// examples use `implements` and pass, because none of them does that.
///
/// The message has to name the type, because the fix is a change to the
/// program's shape rather than to a line: `abstract class` where the source says
/// `interface` compiles and agrees with node on every case, and a reader needs to
/// know which declaration to change.
#[test]
fn an_interface_that_carries_state_is_refused_rather_than_cast() {
    let Some(diagnostics) = declined() else {
        return;
    };

    let found = diagnostics
        .iter()
        .find(|(_, message)| message.contains("implement without extending"));
    let Some((code, message)) = found else {
        panic!(
            "a `checkcast` to a stateful dispatch root was not refused; \
             the backend said: {diagnostics:?}"
        );
    };
    assert_eq!(code, "NTS4001", "refusals from lowering carry the backend's code");
    assert!(
        message.contains("`Stateful`"),
        "names the declaration to change: {message}"
    );
}
