//! Reachable refusals and positive guards for former spelling collisions.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;
use std::path::PathBuf;

mod common;

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Prepare the refusals fixture through the real source producer.
fn prepared_fixture() -> nts_core::hir::Program {
    // **The in-process frontend always runs.** Before the native switch this
    // read `NTS_TSGO` alone and returned `ok` without it, so a
    // bare `cargo test --workspace` -- the run everyone makes by habit -- never
    // ran it: on 2026-09-30 a signature spelled `Erased-Callable` refused four
    // callbacks here while six landings in a row read the suite as green. A
    // check that passes by not running is the failure it exists to prevent.
    let tsconfig = Utf8PathBuf::from_path_buf(
        repository()
            .join("compiler/codegen/jvm/tests/refusals/tsconfig.json")
            .canonicalize()
            .expect("the fixture is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
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

    prepared.program
}

/// Emit the refusals fixture and return every diagnostic the backend produced.
fn emitted_fixture() -> nts_codegen_jvm::Emitted {
    nts_codegen_jvm::emit(&prepared_fixture())
}

fn declined() -> Vec<(String, String)> {
    emitted_fixture()
        .diagnostics
        .into_iter()
        .map(|it| (it.code, it.message))
        .collect()
}

#[test]
fn quoted_properties_keep_distinct_catalogue_storage() {
    let program = prepared_fixture();
    let facts = nts_codegen_jvm::JvmProgram::new(&program);
    let emitted = nts_codegen_jvm::emit(&program);
    let mut physical = std::collections::BTreeMap::new();
    assert!(
        !emitted
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS4013")
    );
    for (name, fields) in [
        ("Collides", &["a b", "a-b", "a$b_1"][..]),
        ("Spelled", &["a b", "a-b"][..]),
    ] {
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == format!("nts/gen/{name}"))
            .expect("the formerly colliding class must actually be emitted");
        let parsed = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.name == name)
            .unwrap();
        for key in fields {
            let at = layout
                .fields
                .iter()
                .position(|field| field.name.public_name() == Some(*key))
                .unwrap();
            let member = nts_codegen_jvm::hierarchy::field_name(&facts, layout, at).unwrap();
            assert!(
                parsed
                    .fields
                    .iter()
                    .any(|field| field.name == member && field.descriptor == "D")
            );
            physical.insert((name, *key), member);
        }
    }
    let dir = std::env::temp_dir().join(format!("nts-quoted-storage-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for class in emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, class.bytes).unwrap();
    }
    std::fs::write(dir.join("nts-runtime.jar"), nts_codegen_jvm::runtime_jar()).unwrap();
    std::fs::write(dir.join("Driver.java"), format!(
        "package nts.gen; public class Driver {{ static void put(Object target, String name, double value) throws Exception {{ java.lang.reflect.Field field = target.getClass().getDeclaredField(name); field.setAccessible(true); field.setDouble(target, value); }} public static void main(String[] args) throws Exception {{ Collides c = new Collides(); put(c,{a:?},1); put(c,{b:?},2); put(c,{c:?},3); Spelled s = new Spelled(); put(s,{d:?},1); put(s,{e:?},2); System.out.println(Program.reach(c)); System.out.println(Program.reachSpelled(s)); }} }}",
        a=physical[&("Collides", "a b")], b=physical[&("Collides", "a-b")], c=physical[&("Collides", "a$b_1")], d=physical[&("Spelled", "a b")], e=physical[&("Spelled", "a-b")],
    )).unwrap();
    let compiled =
        nts_codegen_jvm::toolchain::command(common::tool("javac").expect("JDK required"))
            .current_dir(&dir)
            .args(["-cp", ".:nts-runtime.jar", "-d", ".", "Driver.java"])
            .output()
            .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = nts_codegen_jvm::toolchain::command(common::tool("java").expect("JDK required"))
        .current_dir(&dir)
        .args(["-Xverify:all", "-cp", ".:nts-runtime.jar", "nts.gen.Driver"])
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert_eq!(ran.stdout, b"6.0\n3.0\n");
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
