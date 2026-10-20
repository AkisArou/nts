//! A face that promises nothing -- no fields, no method slots, no
//! family reading through it -- is referred to as the JVM root, so
//! storing a generator where `Iterable<number>` is declared is an
//! upcast rather than a decline.
//!
//! The fixture is test262's `class C { method([]) {} }` shape, typed:
//! `C`, `Iterable<number>` and `Iterable<string>` are one empty layout,
//! and before this the backend declined each store as a generator not
//! extending `C`. So the test pins what was asked of the change:
//!
//! - **per type, per specialization**: each `Iterable` type is root-typed
//!   on its own facts, and `C`'s type, on the same layout, is not;
//! - **a verified upcast, not a widened unchecked cast**: `javap` shows
//!   the generator handed straight to a `java/lang/Object` parameter with
//!   no `checkcast`, and `-Xverify:all` loads every class and runs it;
//! - **the control**: `Named`, a face with a field, keeps its own class.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::Program;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::TypeId;
use std::path::Path;
use std::process::Command;

mod common;

fn prepared() -> Program {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/empty-face/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    nts_core::hir::prepare(&snapshot)
        .expect("valid HIR")
        .program
}

/// The types an interface declaration's instantiations are.
fn face_types(program: &Program, name: &str) -> Vec<TypeId> {
    program
        .interface_identities
        .iter()
        .filter(|identity| identity.name == name)
        .flat_map(|identity| identity.types.iter().copied())
        .collect()
}

/// The emitted classes and the runtime jar, written under `dir`; the
/// classpath that finds both.
fn written(emitted: &nts_codegen_jvm::Emitted, dir: &Path) -> String {
    let _ = std::fs::remove_dir_all(dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    format!("{}:{}", dir.display(), jar.display())
}

/// `javap -c`'s listing of one method of `nts.gen.Program`.
fn disassembled(disassembler: &Path, classpath: &str, signature: &str) -> String {
    let listed = Command::new(disassembler)
        .args(["-c", "-p", "-cp", classpath, "nts.gen.Program"])
        .output()
        .unwrap();
    assert!(
        listed.status.success(),
        "{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .skip_while(|line| !line.contains(signature))
        .take_while(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn each_specialization_is_root_typed_on_its_own_facts() {
    let program = prepared();
    let facts = nts_codegen_jvm::JvmProgram::new(&program);

    // One layout for the class and both specializations: what made the
    // stores declines, and what makes "per type" a real question.
    let shared = program
        .layouts
        .iter()
        .find(|layout| layout.name == "C")
        .expect("C's layout");
    let iterables = face_types(&program, "Iterable");
    assert_eq!(iterables.len(), 2, "Iterable types: {iterables:?}");
    for id in &iterables {
        assert!(shared.types.contains(id), "{id:?} is not on C's layout");
        assert!(nts_codegen_jvm::types::root_typed(&facts, *id), "{id:?}");
    }
    let classes: Vec<&TypeId> = shared
        .types
        .iter()
        .filter(|id| !iterables.contains(id))
        .collect();
    assert_eq!(classes.len(), 1, "C's own types: {classes:?}");
    assert!(!nts_codegen_jvm::types::root_typed(&facts, *classes[0]));

    // The control: a face with a field is not the root.
    let nameds = face_types(&program, "Named");
    assert_eq!(nameds.len(), 1, "Named types: {nameds:?}");
    assert!(!nts_codegen_jvm::types::root_typed(&facts, nameds[0]));
}

#[test]
fn a_store_into_an_empty_face_is_a_verified_upcast() {
    let emitted = nts_codegen_jvm::emit(&prepared());
    assert!(
        emitted.diagnostics.is_empty(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>()
    );

    let (Some(disassembler), Some(compiler), Some(vm)) = (
        common::tool("javap"),
        common::tool("javac"),
        common::tool("java"),
    ) else {
        eprintln!("SKIP empty_face: no JDK, so neither javap nor the verifier has been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-empty-face-{}", std::process::id()));
    let classpath = written(&emitted, &dir);

    let answer = disassembled(&disassembler, &classpath, "public static double answer()");
    for call in [
        "C$method:(Lnts/gen/C;Ljava/lang/Object;)I",
        "C$other:(Lnts/gen/C;Ljava/lang/Object;)I",
    ] {
        assert!(
            answer.contains(call),
            "`answer` does not call {call}:\n{answer}"
        );
    }
    assert!(
        !answer.contains("checkcast"),
        "a cast where an upcast was owed:\n{answer}"
    );
    assert!(
        answer.contains("read:(Lnts/gen/Named;)"),
        "the control lost its class:\n{answer}"
    );

    std::fs::write(
        dir.join("Drive.java"),
        "public class Drive { public static void main(String[] a) {\n\
           nts.gen.Program.module$init();\n\
           System.out.println(nts.gen.Program.answer());\n\
         } }\n",
    )
    .unwrap();
    let built = Command::new(&compiler)
        .args(["-cp", &classpath, "-d"])
        .arg(&dir)
        .arg(dir.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let ran = Command::new(&vm)
        .args(["-Xverify:all", "-cp", &classpath, "Drive"])
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}{}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    // What node prints for the fixture's `answer()`.
    assert_eq!(String::from_utf8_lossy(&ran.stdout).trim(), "4.0");
    std::fs::remove_dir_all(&dir).unwrap();
}
