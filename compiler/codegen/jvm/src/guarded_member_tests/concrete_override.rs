//! A newly qualified interface call must keep an old concrete-base override.
use std::path::{Path, PathBuf};

use nts_core::hir::{GuardedDispatch, HirType, ManagedType, Program};
use nts_jvm_emitter::class::access;
use nts_semantic_schema::TypeId;

use super::{add_bad, command, fixture, parsed};

fn pair() -> (Program, Program) {
    let mut control = fixture(false);
    let mut child = control
        .layouts
        .iter()
        .find(|layout| layout.name == "Good")
        .unwrap()
        .clone();
    child.name = "GoodChild".into();
    child.types = vec![TypeId(7)];
    child.base = Some(TypeId(3));
    control.layouts.push(child);
    let mut subject = control.clone();
    let class = subject
        .funcs
        .iter()
        .find(|func| func.name == "Base#step")
        .unwrap()
        .clone();
    let projected = subject
        .funcs
        .iter()
        .find(|func| func.name == "Base#step@Face")
        .unwrap()
        .clone();
    // This is the pair's only change: the unrelated certified refused receiver.
    add_bad(&mut subject, &class, &projected);
    (control, subject)
}

fn directory() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/guarded-concrete-override-{}-{stamp}",
        std::process::id()
    ));
    std::fs::create_dir_all(&path).unwrap();
    println!("GUARDED_CONCRETE_OVERRIDE_ARTIFACTS {}", path.display());
    path
}

fn preserve(path: &Path, program: &Program, qualified: bool) {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("prepared-program.txt"), format!("{program:#?}")).unwrap();
    let facts = crate::JvmProgram::new(program);
    let good = facts.layout(TypeId(3)).unwrap();
    let child = facts.layout(TypeId(7)).unwrap();
    assert_eq!(child.base, Some(TypeId(3)));
    assert!(
        crate::hierarchy::extended(&facts, good),
        "real HIR child must make Good non-final"
    );
    assert_eq!(facts.guarded_member(0).is_some(), qualified);
    let output = crate::emit(program);
    std::fs::write(
        path.join("emission-diagnostics.txt"),
        format!("{:#?}", output.diagnostics),
    )
    .unwrap();
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    let good = parsed(&output, "nts/gen/Good");
    assert_eq!(
        good.access & access::FINAL,
        0,
        "must exercise an old subclassable concrete class"
    );
    assert_eq!(good.access & access::ABSTRACT, 0);
    let step = good
        .methods
        .iter()
        .find(|method| method.name == "step" && method.descriptor == "(D)V")
        .unwrap();
    assert_eq!(step.access & access::ABSTRACT, 0);
    let child = parsed(&output, "nts/gen/GoodChild");
    assert_eq!(child.super_name.as_deref(), Some("nts/gen/Good"));
    for class in output.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, class.bytes).unwrap();
    }
    std::fs::write(path.join("nts-runtime.jar"), crate::runtime_jar().as_ref()).unwrap();
}

const IMPLEMENTER: &str = "package nts.gen; public final class OldConcreteSubclass extends Good { @Override public void step(double n) { n$count += 100 * n; } }";
const DRIVER: &str = r#"package nts.gen; public final class ConcreteOverrideDriver {
  public static void main(String[] args) {
    OldConcreteSubclass value = new OldConcreteSubclass(); value.step(3);
    Program.invoke_iface(value, 7);
    if (value.n$count != 1000) throw new AssertionError("old plain override bypassed: " + value.n$count);
    System.out.println("CONCRETE_OVERRIDE_OLD_BINARIES_PASS");
  }
}"#;

fn old_binaries(control: &Program, subject: &Program) {
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let path = directory();
    let old = path.join("old");
    let new = path.join("new");
    preserve(&old, control, false);
    preserve(&new, subject, true);
    std::fs::write(old.join("OldConcreteSubclass.java"), IMPLEMENTER).unwrap();
    std::fs::write(old.join("ConcreteOverrideDriver.java"), DRIVER).unwrap();
    command(
        &javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldConcreteSubclass.java",
            "ConcreteOverrideDriver.java",
        ],
        &old,
        "old-javac",
    );
    for name in ["OldConcreteSubclass", "ConcreteOverrideDriver"] {
        let bytes = std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap();
        std::fs::write(new.join(format!("nts/gen/{name}.class")), bytes).unwrap();
    }
    for (directory, label) in [(&old, "old-java"), (&new, "new-java")] {
        command(
            &java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.ConcreteOverrideDriver",
            ],
            directory,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(directory.join(format!("{label}.stdout"))).unwrap(),
            "CONCRETE_OVERRIDE_OLD_BINARIES_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(directory.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
    for name in ["OldConcreteSubclass", "ConcreteOverrideDriver"] {
        assert_eq!(
            std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap(),
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap()
        );
    }
}

#[test]
fn old_subclass_of_nonfinal_concrete_good_keeps_plain_virtual_override() {
    let (control, subject) = pair();
    old_binaries(&control, &subject);
}

const GOOD_STOP: &str = "coherent-good-stop";
const GOOD_REASON: &str = "the actual Good source operation is unsupported";

fn named_good_stop(program: &mut Program, name: &str, original: &str, slots: &[u32]) {
    let contract = program
        .funcs
        .iter()
        .find(|func| func.name == "Base#step")
        .unwrap()
        .clone();
    let mut entry = super::stopped(name, &contract, original, GOOD_REASON);
    entry.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(3)));
    entry.values[0].ty = entry.params[0].ty.clone();
    program.funcs.push(entry);
    program
        .uncompiled
        .push((original.into(), GOOD_REASON.into()));
    program.guarded_dispatch.insert(
        name.into(),
        GuardedDispatch {
            original: original.into(),
            contract: contract.name,
            receiver: TypeId(3),
            slots: slots.iter().copied().collect(),
        },
    );
}

fn with_coherent_good_stop(mut program: Program) -> Program {
    program
        .funcs
        .retain(|func| !["Good#step", "Good#step@Face"].contains(&func.name.as_str()));
    program
        .identity_projections
        .retain(|name, target| name != "Good#step@Face" && target != "Good#step");
    named_good_stop(&mut program, GOOD_STOP, "Good#step", &[0, 1]);
    for layout in &mut program.layouts {
        if ["Good", "GoodChild"].contains(&layout.name.as_str()) {
            layout.methods[0] = Some(GOOD_STOP.into());
            layout.methods[1] = Some(GOOD_STOP.into());
        }
    }
    program
}

// Exercise the actual global licensing path to establish that GOOD_STOP is a
// valid certificate, rather than relying on proof-map presence. Giving the
// class slot a second valid named stop makes this receiver a two-target group;
// any malformed GOOD_STOP would deny the selector for the entire population.
fn assert_good_stop_is_certified(program: &Program) {
    let mut probe = program.clone();
    probe.guarded_dispatch.get_mut(GOOD_STOP).unwrap().slots = [0].into();
    named_good_stop(
        &mut probe,
        "other-good-stop",
        "Good#other-refused-source",
        &[1],
    );
    for layout in &mut probe.layouts {
        if ["Good", "GoodChild"].contains(&layout.name.as_str()) {
            layout.methods[1] = Some("other-good-stop".into());
        }
    }
    assert!(
        crate::JvmProgram::new(&probe).guarded_member(0).is_some(),
        "the actual two-row licensing path must validate GOOD_STOP"
    );
}

#[test]
fn coherent_certified_good_stop_keeps_old_subclass_public_override() {
    let (control, subject) = pair();
    let control = with_coherent_good_stop(control);
    let subject = with_coherent_good_stop(subject);
    assert_good_stop_is_certified(&subject);
    old_binaries(&control, &subject);
}
