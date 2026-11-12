//! The existing outcome and its one-change throwing-base control, unchanged.
//! This observes one normal capture/preparation and the actual backend surface;
//! it does not equate adapters or waive distinct dispatch bodies.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;

use std::path::PathBuf;

use camino::Utf8Path;
use nts_frontend_ts::Frontend;

mod common;

const CASE: &str = "a-throwing-override-escapes-a-try-through-a-base-that-cannot-throw";

fn materialise() -> (scratch::StdScratchDir, PathBuf) {
    let scratch = scratch::StdScratchDir::in_std_target("jvm-throwing-dispatch");
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
    let project = scratch.join(CASE);
    (scratch, project)
}

fn assert_slot_names(program: &nts_core::hir::Program) -> usize {
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
            .map(|member| member.member.as_str()),
        Some("step")
    );
    assert_eq!(
        program.raising_members[&u32::try_from(raising).unwrap()].ordinary_slot,
        Some(u32::try_from(ordinary).unwrap()),
        "the owned ordinary relation survives a quiet body filling both slots"
    );
    for receiver in [base, child] {
        assert_eq!(
            nts_codegen_jvm::hierarchy::declared_member(&facts, receiver, ordinary)
                .unwrap()
                .as_deref(),
            Some("step")
        );
        assert_eq!(
            nts_codegen_jvm::hierarchy::declared_member(&facts, receiver, raising)
                .unwrap()
                .as_deref(),
            Some(facts.dispatch_name(raising).unwrap().as_str())
        );
    }
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, raising, "Base#step").unwrap(),
        facts.dispatch_name(raising).unwrap()
    );
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, ordinary, "Base#step").unwrap(),
        "step"
    );
    raising
}

fn assert_emitted_slots(emitted: &nts_codegen_jvm::Emitted, raising_name: &str) {
    for name in ["Base", "Child"] {
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == format!("nts/gen/{name}"))
            .unwrap();
        let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        for member in ["step", raising_name] {
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
    // The joined semantic rows now reject this missing fact before any class
    // publication, ahead of the later distinct-body conflict check.
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
    let raising: Vec<_> = program
        .member_origins
        .dispatch
        .iter()
        .filter(|(_, member)| member.raising)
        .map(|(slot, _)| *slot)
        .collect();
    assert!(!raising.is_empty(), "the original raising semantic rows");
    for slot in raising {
        assert!(
            emitted.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "NTS4004"
                    && diagnostic.message == format!("raising dispatch slot {slot} has missing or inconsistent producer-owned pair metadata")
            }),
            "missing pair for actual slot {slot} was not named: {:?}",
            emitted.diagnostics
        );
    }
}

#[test]
fn the_throwing_override_and_its_throwing_base_control_both_emit() {
    let (_owner, project) = materialise();
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
    let raising = assert_slot_names(&prepared.program);
    assert!(
        written("Child"),
        "the actual subject class must not disappear: {:?}",
        emitted.diagnostics
    );
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert_emitted_slots(
        &emitted,
        &nts_codegen_jvm::JvmProgram::new(&prepared.program)
            .dispatch_name(raising)
            .unwrap(),
    );
    assert_missing_slot_fact_conflicts(&prepared.program);
}
