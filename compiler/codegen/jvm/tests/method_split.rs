//! A body past the class file's 65,534-byte method limit is split into
//! helpers (`nts_codegen_jvm::split`) rather than declined.
//!
//! The fixture is a module-scope literal of 2048 records -- test262's
//! `Array/prototype/sort/stability-2048-elements.js` shape -- whose
//! `module#init` was 94,835 bytes and declined (NTS4001). Beside it the
//! program declares `module$init$split0`, the JVM spelling the first helper
//! would take, so this also pins that a helper names around a declared
//! function. What is asserted:
//!
//! - the program emits whole, every class verifies under `-Xverify:all`,
//!   and it answers what node does;
//! - the helpers are `private static synthetic` on the program class, so
//!   nothing outside it -- Java callers, interop, the published API -- can
//!   name one, and the declared `module$init$split0` keeps its own name and
//!   stays public.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::Program;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;
use std::time::Instant;

mod common;

fn prepared() -> Program {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/method-split/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    common::prepare(&snapshot).expect("valid HIR").program
}

/// How many helpers `javap -p -v`'s listing of the program class shows,
/// asserting each is `private static` and `ACC_SYNTHETIC`, and that the
/// declared `module$init$split0` is there, public, under its own name.
///
/// Read from method headers only: the lines ending `);` that are not
/// constant-pool entries (`#49 = NameAndType ... // module$init$split1:...`).
fn helpers_are_private(listing: &str) -> usize {
    let mut helpers = 0;
    let mut declared = false;
    let lines: Vec<&str> = listing.lines().map(str::trim).collect();
    for (at, head) in lines.iter().enumerate() {
        if head.starts_with('#') || !head.ends_with(");") || !head.contains("module$init$split") {
            continue;
        }
        let flags = lines[at..]
            .iter()
            .find(|next| next.starts_with("flags:"))
            .copied()
            .unwrap_or_default();
        if head.contains("module$init$split0()") {
            assert!(head.starts_with("public static"), "{head}");
            declared = true;
        } else {
            assert!(head.starts_with("private static"), "{head}");
            assert!(flags.contains("ACC_SYNTHETIC"), "{head}: {flags}");
            helpers += 1;
        }
    }
    assert!(
        declared,
        "the declared `module$init$split0` is missing:\n{listing}"
    );
    helpers
}

#[test]
fn a_body_past_the_method_limit_is_split_into_private_helpers() {
    let program = prepared();
    let started = Instant::now();
    let emitted = nts_codegen_jvm::emit(&program);
    eprintln!("method_split: emitted in {:?}", started.elapsed());
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
        eprintln!("SKIP method_split: no JDK, so neither javap nor the verifier has been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-method-split-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let classpath = format!("{}:{}", dir.display(), jar.display());

    // `-v` prints each method's flags beneath it.
    let listed = Command::new(&disassembler)
        .args(["-p", "-v", "-cp", &classpath, "nts.gen.Program"])
        .output()
        .unwrap();
    assert!(
        listed.status.success(),
        "{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    let helpers = helpers_are_private(&String::from_utf8_lossy(&listed.stdout));
    assert!(
        helpers >= 2,
        "{helpers} helper(s): a 95 KB body needs at least two"
    );

    std::fs::write(
        dir.join("Drive.java"),
        "public class Drive { public static void main(String[] a) {\n\
           nts.gen.Program.module$init();\n\
           System.out.println(nts.gen.Program.total(0) + \" \" + nts.gen.Program.module$init$split0());\n\
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
    // What node prints for the fixture's `total(0)` and `module$init$split0()`.
    assert_eq!(String::from_utf8_lossy(&ran.stdout).trim(), "2052.0 7.0");
    std::fs::remove_dir_all(&dir).unwrap();
}
