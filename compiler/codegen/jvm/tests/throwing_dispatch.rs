//! The existing outcome and its one-change throwing-base control, unchanged.
//! This observes one normal capture/preparation and the actual backend surface;
//! it does not equate adapters or waive distinct dispatch bodies.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use camino::Utf8Path;
use nts_frontend_ts::Frontend;

mod common;

const CASE: &str = "a-throwing-override-escapes-a-try-through-a-base-that-cannot-throw";

fn materialise() -> PathBuf {
    let scratch = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "jvm-throwing-dispatch-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&scratch).unwrap();
    let materialiser = common::repository().join("tooling/conformance/outcomes-project.ts");
    let script = format!(
        "import {{ materialise, OUTCOMES }} from {path:?};\n\
         import {{ join }} from 'node:path';\n\
         materialise(process.argv[1], {case:?}, join(OUTCOMES, {case:?}, 'src'), 'check');",
        path = materialiser.to_str().unwrap(),
        case = CASE,
    );
    let ran = nts_codegen_jvm::toolchain::command("node")
        .args(["--input-type=module", "-e", &script])
        .arg(&scratch)
        .output()
        .expect("the official outcomes materialiser");
    assert!(
        ran.status.success(),
        "materialisation failed: {}",
        String::from_utf8_lossy(&ran.stderr)
    );
    scratch.join(CASE)
}

fn assert_slot_names(program: &nts_core::hir::Program) {
    let facts = nts_codegen_jvm::JvmProgram::new(program);
    let child = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Child")
        .unwrap();
    let base = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Base")
        .unwrap();
    let raising = child
        .methods
        .iter()
        .position(|entry| entry.as_deref() == Some("Child#step@raises"))
        .unwrap();
    let ordinary = child
        .methods
        .iter()
        .position(|entry| entry.as_deref() == Some("Child#step"))
        .unwrap();
    assert_ne!(raising, ordinary);
    assert_eq!(base.methods[raising].as_deref(), Some("Base#step"));
    assert_eq!(base.methods[ordinary].as_deref(), Some("Base#step"));
    assert_eq!(
        program
            .raising_members
            .get(&u32::try_from(raising).unwrap())
            .map(String::as_str),
        Some("step@raises")
    );
    for receiver in [base, child] {
        assert_eq!(
            nts_codegen_jvm::hierarchy::declared_member(&facts, receiver, ordinary).as_deref(),
            Some("step")
        );
        assert_eq!(
            nts_codegen_jvm::hierarchy::declared_member(&facts, receiver, raising).as_deref(),
            Some("step$raises")
        );
    }
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, raising, "Base#step"),
        "step$raises"
    );
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, ordinary, "Base#step"),
        "step"
    );
}

fn assert_emitted_slots(emitted: &nts_codegen_jvm::Emitted) {
    for name in ["Base", "Child"] {
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == format!("nts/gen/{name}"))
            .unwrap();
        let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        for member in ["step", "step$raises"] {
            assert!(
                class
                    .methods
                    .iter()
                    .any(|method| method.name == member && method.descriptor == "(D)D"),
                "{name}.{member}(D)D absent"
            );
        }
    }
}

fn assert_missing_slot_fact_conflicts(program: &nts_core::hir::Program) {
    // One normal prepared program, then a local metadata-only counterfactual.
    // Distinct bodies and all existing backend safety checks remain intact.
    let mut missing = program.clone();
    missing.raising_members.clear();
    let emitted = nts_codegen_jvm::emit(&missing);
    assert!(
        !emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Child"),
        "the original conflicting class unexpectedly emitted without its slot fact"
    );
    assert!(
        emitted.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "NTS4001"
                && diagnostic.message.contains("Child#step")
                && diagnostic.message.contains("Child#step@raises")
        }),
        "the original distinct-body conflict is missing: {:?}",
        emitted.diagnostics
    );
}

#[test]
fn the_throwing_override_and_its_throwing_base_control_both_emit() {
    let project = materialise();
    let config = Utf8Path::from_path(&project).unwrap().join("tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one ordinary snapshot of the unchanged outcome");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).expect("valid JVM host-GC prepared HIR");
    for name in [
        "throughBase",
        "throughBaseAsAValue",
        "throughChild",
        "throughABaseThatCanThrow",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|f| f.name == name && f.exported),
            "source export {name} was removed before JVM emission: {:?}",
            prepared.program.uncompiled
        );
    }
    let hir = project.join("actual-prepared-program.txt");
    std::fs::write(&hir, format!("{:#?}", prepared.program)).unwrap();
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    let report = project.join("actual-emission.txt");
    std::fs::write(&report, format!("{:#?}", emitted.diagnostics)).unwrap();
    for class in &emitted.classes {
        let path = project.join("classes").join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    println!(
        "actual owned HIR: {}; full emission: {}",
        hir.display(),
        report.display()
    );
    let written = |name: &str| {
        emitted
            .classes
            .iter()
            .any(|class| class.binary_name == format!("nts/gen/{name}"))
    };
    assert!(
        written("ThrowingChild"),
        "the one-change throwing-base control is missing: {:?}",
        emitted.diagnostics
    );
    assert_slot_names(&prepared.program);
    assert!(
        written("Child"),
        "the actual subject class must not disappear: {:?}",
        emitted.diagnostics
    );
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert_emitted_slots(&emitted);
    assert_missing_slot_fact_conflicts(&prepared.program);
}
