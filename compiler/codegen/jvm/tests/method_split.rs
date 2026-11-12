//! A body past the class file's 65,534-byte method limit is split into
//! helpers (`nts_codegen_jvm::split`) rather than declined.
//!
//! The fixture is a module-scope literal of 2048 records -- test262's
//! `Array/prototype/sort/stability-2048-elements.js` shape -- whose
//! `module#init` was 94,835 bytes and declined (NTS4001). Beside it the
//! program declares `module$init$split0`, an authored split-looking name.
//! Its public facade stays separate from catalogue-owned helpers. What is asserted:
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
use nts_frontend_ts::Frontend;
use std::time::Instant;

use crate::common;

fn prepared() -> Program {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/method-split/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    common::prepare(&snapshot).expect("valid HIR").program
}

/// Actual helper declarations from the split producer, encoded by the catalogue.
fn helpers_are_private(bytes: &[u8], program: &Program) -> usize {
    let class = nts_jvm_emitter::read::class_file(bytes).expect("the actual program class");
    let declared = class
        .methods
        .iter()
        .find(|method| method.name == "module$init$split0")
        .expect("the authored facade survives");
    assert_ne!(declared.access & nts_jvm_emitter::class::access::PUBLIC, 0);
    let mut taken: std::collections::HashSet<_> = program
        .funcs
        .iter()
        .map(|func| nts_codegen_common::symbols::jvm_member_name(&func.name))
        .collect();
    let mut count = 0;
    for declaration in &program.funcs {
        let Some((_, helpers)) = nts_codegen_jvm::split::split_for_method_limit(
            declaration,
            nts_codegen_jvm::split::FIRST_BUDGET,
            &mut taken,
        ) else {
            continue;
        };
        for helper in helpers {
            let member = nts_codegen_jvm::generated_members::body(&helper.name);
            let method = class
                .methods
                .iter()
                .find(|method| method.name == member)
                .unwrap_or_else(|| {
                    panic!("missing helper declaration {} as {member}", helper.name)
                });
            let required = nts_jvm_emitter::class::access::PRIVATE
                | nts_jvm_emitter::class::access::STATIC
                | nts_jvm_emitter::class::access::SYNTHETIC;
            assert_eq!(
                method.access, required,
                "helper {} as {member}",
                helper.name
            );
            assert!(
                method
                    .code
                    .as_ref()
                    .is_some_and(|code| !code.bytes.is_empty())
            );
            eprintln!(
                "split helper declaration={} member={} descriptor={} flags={:#x}",
                helper.name, member, method.descriptor, method.access
            );
            count += 1;
        }
    }
    count
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

    let (Some(compiler), Some(vm)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP method_split: no JDK, so the Java driver has not run");
        return;
    };
    let dir = crate::scratch::StdScratchDir::path_in_std_target("nts-method-split");
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let classpath = format!("{}:{}", dir.display(), jar.display());

    let program_class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .expect("Program class");
    let helpers = helpers_are_private(&program_class.bytes, &program);
    assert!(
        helpers >= 2,
        "{helpers} helper(s): a 95 KB body needs at least two"
    );

    std::fs::write(
        dir.join("Drive.java"),
        common::java_members("public class Drive { public static void main(String[] a) {\n\
           nts.gen.Program.@@MODULE_INIT@@();\n\
           System.out.println(nts.gen.Program.total(0) + \" \" + nts.gen.Program.module$init$split0());\n\
         } }\n"),
    )
    .unwrap();
    let built = nts_codegen_jvm::toolchain::command(&compiler)
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
    let ran = nts_codegen_jvm::toolchain::command(&vm)
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
