//! A private string carrier changes only a closed, unpublished direct ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::string_accumulators::chains::Plan;
use nts_frontend_ts::Frontend;
use std::path::Path;
mod common;
#[path = "string_chains/pairs.rs"]
mod pairs;

#[test]
fn private_chains_transfer_one_builder_while_observed_versions_stay_strings() {
    let fixture = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/string_chains");
    let prepared = prepared_fixture();
    let program = &prepared.program;
    let proof = Plan::new(program);
    assert!(
        proof.admitted().any(|(name, _)| name == "writer"),
        "{proof:?}"
    );
    for name in ["optionalWriter", "discardedWriter"] {
        assert!(
            proof.admitted().any(|(found, _)| found == name),
            "{name}: {proof:?}"
        );
    }
    let emitted = nts_codegen_jvm::emit(program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
    for func in program
        .funcs
        .iter()
        .filter(|func| !func.abstract_declaration)
    {
        let method = class
            .methods
            .iter()
            .find(|method| method.name == nts_codegen_jvm::body::method_name(&func.name))
            .unwrap();
        if proof.parameter_of(func).is_some() {
            assert_ne!(method.access & nts_jvm_emitter::class::access::PRIVATE, 0);
            assert!(
                method.descriptor.contains("Ljava/lang/StringBuilder;"),
                "{}: {}",
                func.name,
                method.descriptor
            );
            assert!(
                method.descriptor.ends_with(")Ljava/lang/StringBuilder;"),
                "{}: {}",
                func.name,
                method.descriptor
            );
        } else {
            assert!(
                !method.descriptor.contains("Ljava/lang/StringBuilder;"),
                "{}: {}",
                func.name,
                method.descriptor
            );
        }
    }
    for name in [
        "aliasWriter",
        "duplicateWriter",
        "publishingWriter",
        "throwingWriter",
        "fieldWriter",
        "escapedWriter",
    ] {
        assert!(
            !proof.admitted().any(|(found, _)| found == name),
            "{name}: {proof:?}"
        );
    }
    let dir = std::env::temp_dir().join(format!("nts-string-chains-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    compare(
        &dir,
        &fixture,
        "Drive",
        "drive.mjs",
        40,
        &[nts_codegen_jvm::module_init_method()],
    );
    std::fs::remove_dir_all(dir).unwrap();
}

fn prepared_fixture() -> nts_core::hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/string_chains/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let prepared = common::prepare(&snapshot).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    assert!(prepared.program.refused_bodies().next().is_none());
    prepared
}

#[test]
fn a_declined_optional_carrier_stub_has_every_descriptor_local() {
    use nts_core::hir::{HirType, Op, OpKind, ValueId, native};
    let mut program = pairs::program();
    let writer = program
        .funcs
        .iter_mut()
        .find(|func| func.name == "pairWriter")
        .unwrap();
    let poison = ValueId(u32::try_from(writer.values.len()).unwrap());
    // A valid native sizeof operation reaches a backend refusal on the JVM.
    // Adding it leaves the writer's callers and optional parameter ABI intact.
    writer.values.push(Op {
        kind: OpKind::NativeSizeOf(native::Pointee::Scalar(native::Scalar::Int)),
        ty: HirType::NUMBER,
        origin: writer.origin.clone(),
    });
    writer.blocks[0].ops.push(poison);
    program.funcs.push(pairs::scratch_return());
    assert_eq!(nts_core::hir::verify::verify(&program), Ok(()));
    let proof = Plan::new(&program);
    assert!(
        proof.admitted().any(|(name, _)| name == "pairWriter"),
        "{proof:?}"
    );
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted
            .diagnostics
            .iter()
            .any(|diag| diag.message.contains("pairWriter")),
        "{:?}",
        emitted.diagnostics
    );
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
    for name in ["pairWriter", "optionalReturn"] {
        let method = class
            .methods
            .iter()
            .find(|method| method.name == name)
            .unwrap();
        let words: usize = nts_jvm_emitter::descriptor::parameters(&method.descriptor)
            .unwrap()
            .iter()
            .map(|param| usize::from(nts_jvm_emitter::descriptor::words(param)))
            .sum();
        assert!(
            usize::from(method.code.as_ref().unwrap().max_locals) >= words,
            "{} needs {words} locals, stub has {}",
            method.descriptor,
            method.code.as_ref().unwrap().max_locals
        );
        if name == "optionalReturn" {
            assert_eq!(method.descriptor, "(DZ[D)Z");
        }
    }
}

fn compare(
    dir: &Path,
    fixture: &Utf8Path,
    driver: &str,
    node_driver: &str,
    expected: usize,
    args: &[String],
) {
    let javac = common::tool("javac").expect("JDK required for the executed carrier guard");
    let java = common::tool("java").expect("JDK required for the executed carrier guard");
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let classpath = format!("{}:{}", dir.display(), jar.display());
    let compiled = nts_codegen_jvm::toolchain::command(javac)
        .args(["-cp", &classpath, "-d"])
        .arg(dir)
        .arg(fixture.join(format!("{driver}.java")))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = nts_codegen_jvm::toolchain::command(java)
        .args(["-Xverify:all", "-cp", &classpath, driver])
        .args(args)
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        ran.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let node = std::process::Command::new("node")
        .arg(fixture.join(node_driver))
        .output()
        .unwrap();
    assert!(
        node.status.success(),
        "{}",
        String::from_utf8_lossy(&node.stderr)
    );
    assert_eq!(
        ran.stdout, node.stdout,
        "shared writers, old aliases, duplicate sinks, publication and caught throws"
    );
    assert_eq!(
        String::from_utf8(ran.stdout).unwrap().lines().count(),
        expected
    );
}

#[test]
fn split_optional_arguments_and_a_private_carrier_share_one_descriptor() {
    let program = pairs::program();
    assert_eq!(nts_core::hir::verify::verify(&program), Ok(()));
    assert!(matches!(
        program.funcs[0].params[1].ty,
        nts_core::hir::HirType::PossiblyUndefined(_)
    ));
    let proof = Plan::new(&program);
    assert_eq!(proof.parameter_of(&program.funcs[0]), Some(0), "{proof:?}");
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    let parsed = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
    let method = parsed
        .methods
        .iter()
        .find(|method| method.name == "pairWriter")
        .unwrap();
    assert_eq!(
        method.descriptor,
        "(Ljava/lang/StringBuilder;DZ)Ljava/lang/StringBuilder;"
    );
    let dir = std::env::temp_dir().join(format!("nts-string-pair-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, class.bytes).unwrap();
    }
    let fixture = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/string_chains");
    compare(&dir, &fixture, "PairDrive", "pairs.mjs", 16, &[]);
    std::fs::remove_dir_all(dir).unwrap();
}
