//! What a Java caller can reach, and what it deliberately cannot.
//!
//! Two access flags decide the whole published surface, and both were measured
//! before being relied on:
//!
//! - **Fields are package-private**, so `hir::fields`'s narrowing stays sound
//!   once an object reaches Java. `field_visibility.rs` covers that.
//! - **A method's static is `access::SYNTHETIC` exactly when an instance method
//!   replaces it.** `Session$bump` is not something a caller should type -- `$`
//!   is the JVM's own mark for a generated name -- and `javac` *refuses to
//!   reference* a synthetic member rather than merely hiding it. So the flag is
//!   safe only because `member_forwarders` gives Java `s.bump()` instead, and
//!   the two must move together or TypeScript becomes uncallable from Java.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_jvm_emitter::{class::access, read};
use std::path::{Path, PathBuf};


fn repository() -> PathBuf {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    from.canonicalize().unwrap_or(from)
}

/// Emit `examples/interop/ts-from-java`, which exists to be read from Java.
/// The program both helpers below are about, prepared once.
///
/// Shared rather than duplicated because the two answers must be about the same
/// build: a test asserting the surface and a test asserting the pool disagreeing
/// about which project or which provider they compiled would be two results
/// nobody could compare.
fn prepared() -> Option<hir::Program> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP java_surface: NTS_TSGO is not set");
        return None;
    };
    if !tsgo.exists() {
        eprintln!("SKIP java_surface: no tsgo at {tsgo}");
        return None;
    }
    let tsconfig = Utf8PathBuf::from_path_buf(
        repository()
            .join("examples/interop/ts-from-java/tsconfig.json")
            .canonicalize()
            .expect("the project is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    assert!(!snapshot.has_errors(), "ts-from-java should typecheck");
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() },
    )
    .expect("prepared HIR should verify");
    Some(prepared.program)
}

/// The emitted classes as bytes, for a question about the constant pool.
fn emitted_bytes() -> Option<Vec<(String, Vec<u8>)>> {
    let program = prepared()?;
    Some(
        nts_codegen_jvm::emit(&program)
            .classes
            .iter()
            .map(|class| (class.binary_name.clone(), class.bytes.clone()))
            .collect(),
    )
}

fn emitted() -> Option<Vec<read::ClassFile>> {
    let program = prepared()?;
    Some(
        nts_codegen_jvm::emit(&program)
            .classes
            .iter()
            .map(|class| read::class_file(&class.bytes).expect("our own output parses"))
            .collect(),
    )
}

/// **Proven to fail in both directions**, because a test that only rejects one
/// kind of wrong is half a test. Sabotaged on 2026-09-13:
///
/// | the rule replaced by | fails on |
/// | --- | --- |
/// | `let synthetic = 0` -- nothing marked | *a replaced static is synthetic* |
/// | `let synthetic = access::SYNTHETIC` -- everything marked | *a free function is the API* |
///
/// The second is the one worth having. Marking every static is the obvious
/// simplification, it passes the first assertion, and it makes every free
/// function in the program uncallable from Java -- silently, because
/// `javac` reports a missing symbol rather than a visibility error.
#[test]
fn a_methods_static_is_synthetic_and_a_free_functions_is_not() {
    let Some(classes) = emitted() else { return };
    let program = classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .expect("a Program class");

    let flags = |name: &str| {
        program.methods.iter().find(|m| m.name == name).map(|m| m.access)
    };

    // A class method's static: public, static, and **synthetic**, because
    // `Session.bump()` is the API and this is the implementation.
    let bump = flags("Session$bump").expect("Session$bump");
    assert!(bump & access::STATIC != 0, "still a static");
    assert!(
        bump & access::SYNTHETIC != 0,
        "a replaced static is synthetic, so `javac` refuses `Program.Session$bump(s)`"
    );

    // **The control, and it is the half that matters.** A free function has no
    // forwarder, so `Program.greet(...)` IS its API and marking it synthetic
    // would make it uncallable. A rule that marked every static would pass the
    // assertion above and break every free function in the program.
    let greet = flags("greet").expect("greet");
    assert!(greet & access::STATIC != 0 && greet & access::PUBLIC != 0, "public static");
    assert!(
        greet & access::SYNTHETIC == 0,
        "a free function is the API and must stay referenceable from Java"
    );
}

#[test]
fn a_class_carries_an_instance_method_for_each_of_its_statics() {
    let Some(classes) = emitted() else { return };
    let session = classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Session")
        .expect("a Session class");

    for member in ["bump", "hits"] {
        let found = session
            .methods
            .iter()
            .find(|m| m.name == member)
            .unwrap_or_else(|| panic!("Session.{member}()"));
        assert!(found.access & access::PUBLIC != 0, "{member} is public");
        assert!(found.access & access::STATIC == 0, "{member} is an instance method");
        // The receiver is implicit, so the forwarder takes one fewer argument
        // than the static it calls.
        assert_eq!(found.descriptor, "()D", "{member} takes no explicit receiver");
    }

    // The control: the class has not simply grown every function. `greet` is a
    // free function and belongs on `Program` alone.
    assert!(
        !session.methods.iter().any(|m| m.name == "greet"),
        "a free function does not become an instance method"
    );
}

/// **Zero interface dispatch on `java.util.Map` or `java.util.Set`**, which
/// `docs/jvm-interop.md` row 7 calls "zero, by construction".
///
/// Every table operation is a `public static` taking the table as its first
/// argument, so emitted code never calls through the interface -- an interface a
/// class does not call through is itable entries and no instructions.
///
/// **Checked by absence from the constant pool**, which is stronger than
/// counting `invokeinterface` and needs no JDK: a class cannot dispatch on a
/// type it never names, and every `invokeinterface` requires an
/// `InterfaceMethodref` whose class entry is that UTF-8 string. So an emitted
/// class containing neither string cannot reach either interface at all.
///
/// The row became worth asserting rather than believing when `NtsSet` was split
/// off `NtsMap`: a refactor that gives a helper a new receiver type is exactly
/// the kind that turns a static into a virtual call without anyone noticing.
#[test]
fn no_emitted_class_names_a_java_collection_interface() {
    let Some(classes) = emitted_bytes() else {
        return;
    };
    assert!(!classes.is_empty(), "ts-from-java emits classes");

    // **The control, because a search that finds nothing proves nothing until it
    // can find something.** `ts-from-java` returns a `Map` and a `Set`, so its
    // `Program` must name the concrete classes even though it names neither
    // interface -- which is the whole claim in one line. Without this, deleting
    // the scan's body would leave the assertion below passing.
    let names = |needle: &str| {
        classes.iter().any(|(_, bytes)| bytes.windows(needle.len()).any(|w| w == needle.as_bytes()))
    };
    assert!(names("nts/rt/NtsMap"), "the emitted code names the concrete Map");
    assert!(names("nts/rt/NtsSet"), "the emitted code names the concrete Set");

    for (name, bytes) in &classes {
        for interface in ["java/util/Map", "java/util/Set"] {
            assert!(
                !bytes.windows(interface.len()).any(|w| w == interface.as_bytes()),
                "`{name}` names `{interface}` in its constant pool, so it may be dispatching \
                 through the interface where every table operation should be an `invokestatic`"
            );
        }
    }
}
