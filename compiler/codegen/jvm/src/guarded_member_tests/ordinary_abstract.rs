//! An ordinary abstract class must not shadow a marked interface's default.
//! This test is independently usable on the production code before the fix.
use std::path::{Path, PathBuf};

use nts_core::hir::{HirType, ManagedType, Program};
use nts_jvm_emitter::class::access;
use nts_semantic_schema::TypeId;

use super::{command, fixture, parsed};
use crate::{JvmProgram, emit, guarded_members, hierarchy};

fn pair() -> (Program, Program) {
    let mut control = fixture(false);
    let mut abstract_class = control
        .layouts
        .iter()
        .find(|l| l.name == "Good")
        .unwrap()
        .clone();
    abstract_class.name = "OrdinaryAbstract".into();
    abstract_class.types = vec![TypeId(9)];
    abstract_class.base = None;
    abstract_class.interfaces = vec![TypeId(2)];
    abstract_class.methods = vec![Some("OrdinaryAbstract#step".into()), None];
    abstract_class.fields[0].declared_by = Some(TypeId(9));
    control.layouts.push(abstract_class);
    let mut contract = super::body("OrdinaryAbstract#step", 9);
    contract.abstract_declaration = true;
    control.funcs.push(contract);
    let mut subject = control.clone();
    let class = subject
        .funcs
        .iter()
        .find(|f| f.name == "Base#step")
        .unwrap()
        .clone();
    let projected = subject
        .funcs
        .iter()
        .find(|f| f.name == "Base#step@Face")
        .unwrap()
        .clone();
    // The only subject change is an unrelated certified refused receiver.
    super::add_bad(&mut subject, &class, &projected);
    (control, subject)
}

fn preserve(path: &Path, program: &Program, qualified: bool) {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("prepared-program.txt"), format!("{program:#?}")).unwrap();
    let facts = JvmProgram::new(program);
    let layout = facts.layout(TypeId(9)).unwrap();
    assert!(!hierarchy::is_interface(&facts, layout));
    assert!(!facts.is_split(layout));
    assert_eq!(layout.base, None);
    assert_eq!(layout.interfaces, [TypeId(2)]);
    let contract = facts
        .funcs
        .iter()
        .find(|f| f.name == "OrdinaryAbstract#step")
        .unwrap();
    assert_eq!(
        contract.params[0].ty,
        HirType::Managed(ManagedType::Object(TypeId(9)))
    );
    assert_eq!(facts.guarded_member(0).is_some(), qualified);
    let output = emit(program);
    std::fs::write(
        path.join("emission-diagnostics.txt"),
        format!("{:#?}", output.diagnostics),
    )
    .unwrap();
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    let class = parsed(&output, "nts/gen/OrdinaryAbstract");
    assert_eq!(class.access & access::INTERFACE, 0);
    assert_ne!(class.access & access::ABSTRACT, 0);
    let plain = class
        .methods
        .iter()
        .find(|m| m.name == "step" && m.descriptor == "(D)V")
        .unwrap();
    assert_ne!(plain.access & access::ABSTRACT, 0);
    // Retain and run the binaries before asserting the new wrapper's shape:
    // on old production the real Java failure must remain observable.
    for class in output.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, class.bytes).unwrap();
    }
    std::fs::write(path.join("nts-runtime.jar"), crate::runtime_jar().as_ref()).unwrap();
}

const IMPLEMENTER: &str = "package nts.gen; public final class OldAbstractSubclass extends OrdinaryAbstract { public double calls; @Override public void step(double n) { calls += n; } }";
const DRIVER: &str = r#"package nts.gen; public final class AbstractOverrideDriver {
 public static void main(String[] args) {
  OldAbstractSubclass value = new OldAbstractSubclass(); value.step(3); Program.invoke_iface(value, 7);
  if (value.calls != 10) throw new AssertionError("old abstract override bypassed: " + value.calls);
  System.out.println("ORDINARY_ABSTRACT_OLD_BINARIES_PASS");
 }
}"#;

#[test]
fn ordinary_abstract_implementer_keeps_old_plain_subclass_override() {
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/guarded-ordinary-abstract-{}-{stamp}",
        std::process::id()
    ));
    println!(
        "GUARDED_ORDINARY_ABSTRACT_ARTIFACTS {}",
        directory.display()
    );
    let old = directory.join("old");
    let new = directory.join("new");
    let (control, subject) = pair();
    preserve(&old, &control, false);
    preserve(&new, &subject, true);
    std::fs::write(old.join("OldAbstractSubclass.java"), IMPLEMENTER).unwrap();
    std::fs::write(old.join("AbstractOverrideDriver.java"), DRIVER).unwrap();
    command(
        &javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldAbstractSubclass.java",
            "AbstractOverrideDriver.java",
        ],
        &old,
        "old-javac",
    );
    for name in ["OldAbstractSubclass", "AbstractOverrideDriver"] {
        let bytes = std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap();
        std::fs::write(new.join(format!("nts/gen/{name}.class")), bytes).unwrap();
    }
    for (path, label) in [(&old, "old-java"), (&new, "new-java")] {
        command(
            &java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.AbstractOverrideDriver",
            ],
            path,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stdout"))).unwrap(),
            "ORDINARY_ABSTRACT_OLD_BINARIES_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
    for name in ["OldAbstractSubclass", "AbstractOverrideDriver"] {
        assert_eq!(
            std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap(),
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap()
        );
    }
    let bytes = std::fs::read(new.join("nts/gen/OrdinaryAbstract.class")).unwrap();
    let class = nts_jvm_emitter::read::class_file(&bytes).unwrap();
    let name = guarded_members::internal_name(0);
    let wrapper = class
        .methods
        .iter()
        .find(|m| m.name == name && m.descriptor == "(D)V")
        .unwrap();
    assert_eq!(wrapper.access & access::ABSTRACT, 0);
    assert!(wrapper.code.as_ref().unwrap().bytes.contains(&0xb6));
}
