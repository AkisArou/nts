//! The existing outcome and its one-change throwing-base control, unchanged,
//! and a quiet override whose one body fills both of its slots
//! (`quiet-override`). This observes one normal capture/preparation and the
//! actual backend surface; it does not equate adapters or waive distinct
//! dispatch bodies.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;

use std::path::PathBuf;

use camino::Utf8Path;
use nts_frontend_ts::Frontend;

use crate::common;

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

fn layout<'p>(program: &'p nts_core::hir::Program, name: &str) -> &'p nts_core::hir::Layout {
    program
        .layouts
        .iter()
        .find(|layout| layout.name == name)
        .unwrap()
}

/// The raising and ordinary slots of `step`, read off `holder`'s entries, and
/// the owned facts both receivers publish them by: the member identity, the
/// ordinary relation and each slot's declared JVM member.
fn assert_slot_names(
    program: &nts_core::hir::Program,
    base: &str,
    holder: &str,
    raising_body: &str,
) -> (usize, usize) {
    let facts = nts_codegen_jvm::JvmProgram::new(program);
    let base = layout(program, base);
    let child = layout(program, holder);
    // The raising slot is the one the owned facts mark raising, since a quiet
    // body fills it under the same name as the ordinary slot it pairs with.
    let (raising, member) = program
        .raising_members
        .iter()
        .find(|(slot, _)| {
            child
                .methods
                .get(usize::try_from(**slot).unwrap())
                .and_then(Option::as_deref)
                == Some(raising_body)
        })
        .map(|(slot, member)| (usize::try_from(*slot).unwrap(), member))
        .unwrap();
    assert_eq!(member.member, "step");
    let ordinary = usize::try_from(
        member
            .ordinary_slot
            .expect("the owned ordinary relation survives whichever body fills the raising slot"),
    )
    .unwrap();
    assert_ne!(raising, ordinary);
    assert_eq!(
        child.methods[ordinary].as_deref(),
        Some(format!("{holder}#step").as_str())
    );
    // A receiver publishes a slot only where it holds an entry for it: the
    // holder holds both, and a base whose body pruning removed holds none.
    let expected = [
        (ordinary, "step".to_owned()),
        (raising, facts.dispatch_name(raising).unwrap()),
    ];
    for receiver in [base, child] {
        for (slot, member) in &expected {
            let declared =
                nts_codegen_jvm::hierarchy::declared_member(&facts, receiver, *slot).unwrap();
            match receiver.methods.get(*slot).and_then(Option::as_ref) {
                Some(_) => assert_eq!(declared.as_deref(), Some(member.as_str())),
                None => assert_eq!(declared, None, "{} holds no slot {slot}", receiver.name),
            }
        }
    }
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, raising, raising_body).unwrap(),
        facts.dispatch_name(raising).unwrap()
    );
    assert_eq!(
        nts_codegen_jvm::hierarchy::slot_member(&facts, ordinary, &format!("{holder}#step"))
            .unwrap(),
        "step"
    );
    (raising, ordinary)
}

fn assert_emitted_slots(emitted: &nts_codegen_jvm::Emitted, classes: &[&str], members: &[&str]) {
    for name in classes {
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == format!("nts/gen/{name}"))
            .unwrap();
        let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        for member in members {
            assert!(
                class
                    .methods
                    .iter()
                    .any(|method| method.name == *member && method.descriptor == "(D)D"),
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
    // Since #843 a call through `Base` asks `Child`'s override too, so
    // `Base#step` can raise and its raising slot is never its quiet ordinary
    // body. Here every call is specialised to `Child`, so the copy that slot
    // would hold is pruned and the slot is empty.
    let (raising, ordinary) =
        assert_slot_names(&prepared.program, "Base", "Child", "Child#step@raises");
    let base = layout(&prepared.program, "Base");
    assert_eq!(base.methods[ordinary].as_deref(), Some("Base#step"));
    assert_ne!(base.methods[raising].as_deref(), Some("Base#step"));
    assert!(
        written("Child"),
        "the actual subject class must not disappear: {:?}",
        emitted.diagnostics
    );
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let raising_name = nts_codegen_jvm::JvmProgram::new(&prepared.program)
        .dispatch_name(raising)
        .unwrap();
    assert_emitted_slots(&emitted, &["Child"], &["step", &raising_name]);
    assert_emitted_slots(&emitted, &["Base"], &["step"]);
    assert_missing_slot_fact_conflicts(&prepared.program);
}

/// A quiet override under a base that can throw has no raising copy, so its
/// one body fills both slots, and the class publishes it under both members.
#[test]
fn a_quiet_override_fills_both_of_its_slots_with_one_body() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/quiet-override/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one ordinary snapshot of the quiet override");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).expect("valid JVM host-GC prepared HIR");
    let (raising, ordinary) = assert_slot_names(&prepared.program, "Loud", "Quiet", "Quiet#step");
    let quiet = layout(&prepared.program, "Quiet");
    assert_eq!(quiet.methods[raising], quiet.methods[ordinary]);
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let raising_name = nts_codegen_jvm::JvmProgram::new(&prepared.program)
        .dispatch_name(raising)
        .unwrap();
    assert_emitted_slots(&emitted, &["Quiet"], &["step", &raising_name]);
}
