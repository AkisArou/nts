//! The retained runtime failure uses a stateful class + companion interface,
//! unlike the fieldless direct-interface control. No frontend capture here.
use super::{CLASS_STOP, FACE_STOP, add_bad, command, fixture, parsed, push, write_classes};
use crate::{JvmProgram, emit, guarded_members, hierarchy, instance_descriptor, types};
use nts_core::hir::{
    Block, Callee, Field, Func, HirType, InterfaceIdentity, Layout, ManagedType, Op, OpKind,
    Program, SignatureFace, Terminator, ValueId,
};
use nts_jvm_emitter::class::access;
use nts_semantic_schema::{PropertyKey, TypeId};
use std::path::{Path, PathBuf};

fn stateful(program: &mut Program) {
    let face = program
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "Face")
        .unwrap();
    face.fields.push(Field {
        name: PropertyKey::Name("state".into()),
        ty: HirType::NUMBER,
        written: None,
        declared_by: Some(TypeId(2)),
        readonly: false,
    });
    program.interface_identities.push(InterfaceIdentity {
        symbol: 2,
        name: "Face".into(),
        types: vec![TypeId(2)],
        names: std::collections::BTreeMap::default(),
        parents: [(TypeId(2), Vec::new())].into(),
    });
}

fn remap(program: &mut Program, reversed: bool) -> usize {
    let interface = if reversed { 88 } else { 83 };
    let class = if reversed { 83 } else { 88 };
    for layout in &mut program.layouts {
        let old = std::mem::take(&mut layout.methods);
        layout.methods = vec![None; 89];
        layout.methods[interface] = old.first().cloned().flatten();
        layout.methods[class] = old.get(1).cloned().flatten();
    }
    for proof in program.guarded_dispatch.values_mut() {
        proof.slots = proof
            .slots
            .iter()
            .map(|slot| {
                if *slot == 0 {
                    u32::try_from(interface).unwrap()
                } else {
                    u32::try_from(class).unwrap()
                }
            })
            .collect();
    }
    for func in &mut program.funcs {
        for value in &mut func.values {
            if let OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } = &mut value.kind
            {
                *slot = u32::try_from(if *slot == 0 { interface } else { class }).unwrap();
            }
        }
    }
    interface
}

fn split_fixture(bad: bool, reversed: bool) -> Program {
    let mut program = fixture(bad);
    stateful(&mut program);
    remap(&mut program, reversed);
    program
}

fn assert_split(program: &Program) {
    let facts = JvmProgram::new(program);
    let face = facts.layout(TypeId(2)).unwrap();
    assert_eq!(face.fields.len(), 1, "real retained state prerequisite");
    assert!(
        !hierarchy::is_interface(&facts, face),
        "must not test the old fieldless path"
    );
    assert!(
        facts.is_split(face),
        "actual normal JVM split planning prerequisite"
    );
    assert_eq!(
        types::object_reference(types::DEFAULT_PACKAGE, &facts, TypeId(2)),
        "nts/gen/Face$Face"
    );
}

fn surfaces(program: &Program, interface_slot: usize, descriptor: &str) {
    assert_split(program);
    let facts = JvmProgram::new(program);
    let internal = guarded_members::internal_name(interface_slot);
    assert_eq!(
        facts.guarded_member(interface_slot),
        Some(internal.as_str())
    );
    let output = emit(program);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    for (name, interface) in [("nts/gen/Face", false), ("nts/gen/Face$Face", true)] {
        let class = parsed(&output, name);
        assert_eq!(class.access & access::INTERFACE != 0, interface);
        let plain = class
            .methods
            .iter()
            .find(|m| m.name == "step" && m.descriptor == descriptor)
            .unwrap();
        assert_ne!(
            plain.access & access::ABSTRACT,
            0,
            "old public declaration changed"
        );
        let default = class
            .methods
            .iter()
            .find(|m| m.name == internal && m.descriptor == descriptor)
            .unwrap();
        assert_eq!(
            default.access & access::ABSTRACT,
            0,
            "new abstract obligation"
        );
        assert!(
            default
                .code
                .as_ref()
                .is_some_and(|body| !body.bytes.is_empty())
        );
        let unique: std::collections::BTreeSet<_> = class
            .methods
            .iter()
            .map(|m| (&m.name, &m.descriptor))
            .collect();
        assert_eq!(
            unique.len(),
            class.methods.len(),
            "duplicate member/descriptor"
        );
    }
    let bad = parsed(&output, "nts/gen/Bad");
    for name in ["step", internal.as_str()] {
        assert_eq!(
            bad.methods
                .iter()
                .filter(|m| m.name == name && m.descriptor == descriptor)
                .count(),
            1
        );
    }
}

#[test]
fn actual_stateful_companion_domain_keeps_both_public_surfaces_in_both_slot_orders() {
    for reversed in [false, true] {
        surfaces(
            &split_fixture(true, reversed),
            if reversed { 88 } else { 83 },
            "(D)V",
        );
    }
}

fn erased_function(func: &mut Func, projection: Option<&str>, virtual_call: bool) {
    func.params[1].ty = HirType::Erased;
    let mut callback = func.params[1].clone();
    callback.name = "callback".into();
    callback.ty = HirType::Managed(ManagedType::Object(TypeId(7)));
    func.params.push(callback);
    func.values = func
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: param.origin.clone(),
        })
        .collect();
    func.blocks = vec![Block {
        params: Vec::new(),
        ops: vec![ValueId(0), ValueId(1), ValueId(2)],
        terminator: Terminator::Return(None),
    }];
    if let Some(target) = projection {
        push(
            func,
            OpKind::Call {
                callee: Callee::Direct(target.into()),
                args: vec![ValueId(0), ValueId(1), ValueId(2)],
                frame: None,
            },
            HirType::Void,
        );
    } else if virtual_call {
        push(
            func,
            OpKind::Call {
                callee: Callee::Virtual {
                    slot: 0,
                    declared: "Face#step".into(),
                },
                args: vec![ValueId(0), ValueId(1), ValueId(2)],
                frame: None,
            },
            HirType::Void,
        );
    }
}

fn actual_abi_fixture() -> Program {
    let mut program = fixture(false);
    stateful(&mut program);
    for func in &mut program.funcs {
        let projection = program
            .identity_projections
            .get(&func.name)
            .map(String::as_str);
        let virtual_call = func.name == "invoke_iface";
        erased_function(func, projection, virtual_call);
    }
    let class = program
        .funcs
        .iter()
        .find(|f| f.name == "Base#step")
        .unwrap()
        .clone();
    let face = program
        .funcs
        .iter()
        .find(|f| f.name == "Base#step@Face")
        .unwrap()
        .clone();
    add_bad(&mut program, &class, &face);
    program.layouts.push(Layout {
        name: "Callback".into(),
        types: vec![TypeId(7)],
        fields: Vec::new(),
        methods: Vec::new(),
        base: None,
        interfaces: Vec::new(),
    });
    program.signature_faces.insert(
        TypeId(7),
        SignatureFace {
            params: Vec::new(),
            returns: Some(HirType::Void),
        },
    );
    remap(&mut program, false);
    program
}

#[test]
fn retained_erased_error_and_callable_descriptor_reaches_the_consumer() {
    let program = actual_abi_fixture();
    let facts = JvmProgram::new(&program);
    let target = program
        .funcs
        .iter()
        .find(|func| func.name == FACE_STOP)
        .unwrap();
    let descriptor = "(Lnts/rt/NtsValue;Lnts/gen/erased/Callable;)V";
    assert_eq!(
        instance_descriptor(types::DEFAULT_PACKAGE, &facts, target).as_deref(),
        Some(descriptor)
    );
    surfaces(&program, 83, descriptor);
}

fn assert_rejected(program: &Program) {
    assert_split(program);
    assert_eq!(JvmProgram::new(program).guarded_member(83), None);
    let output = emit(program);
    assert!(
        !output
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Bad")
    );
    assert!(
        output
            .diagnostics
            .iter()
            .any(|d| d.message.contains("distinct dispatch bodies")),
        "{:?}",
        output.diagnostics
    );
}

#[test]
fn concrete_companion_and_missing_certificates_keep_the_actual_split_domain_closed() {
    let mut concrete = split_fixture(true, false);
    concrete
        .funcs
        .iter_mut()
        .find(|f| f.name == "Face#step")
        .unwrap()
        .abstract_declaration = false;
    assert_rejected(&concrete);
    let mut absent = split_fixture(true, false);
    absent.guarded_dispatch.remove(FACE_STOP);
    assert_rejected(&absent);
    let mut wrong = split_fixture(true, false);
    wrong.guarded_dispatch.get_mut(FACE_STOP).unwrap().receiver = TypeId(0);
    assert_rejected(&wrong);
}

#[test]
fn an_uncovered_receiver_and_field_selector_cannot_gain_a_companion_alias() {
    let mut program = split_fixture(true, false);
    let mut layout = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Bad")
        .unwrap()
        .clone();
    layout.name = "Unproved".into();
    layout.types = vec![TypeId(8)];
    for (slot, name) in [(83, FACE_STOP), (88, CLASS_STOP)] {
        let mut func = program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .unwrap()
            .clone();
        func.name = format!("unproved-{slot}");
        func.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(8)));
        func.values[0].ty = func.params[0].ty.clone();
        layout.methods[slot] = Some(func.name.clone());
        program.funcs.push(func);
    }
    program.layouts.push(layout);
    assert_rejected(&program);
    let mut fields = split_fixture(true, false);
    fields
        .interface_access
        .families
        .push(nts_core::hir::interface_access::Family {
            face: TypeId(2),
            member: PropertyKey::Name("state".into()),
            field: Some(0),
            getter: nts_core::hir::interface_access::Entry {
                slot: 83,
                declared: "Face#get state@interface2".into(),
            },
            setter: None,
            raising: Vec::new(),
            owners: Vec::new(),
            eager: false,
            pending: false,
            stored_dispatch: false,
        });
    let facts = JvmProgram::new(&fields);
    assert_eq!(facts.guarded_member(83), None);
    assert_eq!(
        hierarchy::slot_member(&facts, 83, FACE_STOP),
        "get$state$interface2"
    );
}

fn directory() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/guarded-split-{}-{stamp}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    println!("GUARDED_SPLIT_ARTIFACTS {}", dir.display());
    dir
}

fn old_binaries(java: &Path, javac: &Path, old: &Path, new: &Path) {
    std::fs::write(old.join("OldImpl.java"), OLD_IMPLEMENTER).unwrap();
    std::fs::write(old.join("OldExtender.java"), OLD_SUBCLASS).unwrap();
    std::fs::write(old.join("SplitCompatibilityDriver.java"), OLD_DRIVER).unwrap();
    command(
        javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldImpl.java",
            "OldExtender.java",
            "SplitCompatibilityDriver.java",
        ],
        old,
        "old-javac",
    );
    for name in ["OldImpl", "OldExtender", "SplitCompatibilityDriver"] {
        let binary = std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap();
        std::fs::write(new.join(format!("nts/gen/{name}.class")), &binary).unwrap();
        assert_eq!(
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap(),
            binary
        );
    }
    for (path, label) in [(old, "old-compatible-java"), (new, "new-compatible-java")] {
        command(
            java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.SplitCompatibilityDriver",
            ],
            path,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stdout"))).unwrap(),
            "SPLIT_OLD_BINARIES_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
}

#[test]
fn old_companion_implementer_and_abstract_class_subclass_keep_their_binary_abi() {
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let dir = directory();
    let old = dir.join("old");
    let new = dir.join("new");
    write_classes(&old, &split_fixture(false, false));
    write_classes(&new, &split_fixture(true, false));
    old_binaries(&java, &javac, &old, &new);
    std::fs::write(new.join("SplitDriver.java"), NEW_DRIVER).unwrap();
    command(
        &javac,
        &["-cp", ".:nts-runtime.jar", "-d", ".", "SplitDriver.java"],
        &new,
        "new-javac",
    );
    command(
        &java,
        &[
            "-Xverify:all",
            "-cp",
            ".:nts-runtime.jar",
            "nts.gen.SplitDriver",
        ],
        &new,
        "new-java",
    );
    assert_eq!(
        std::fs::read_to_string(new.join("new-java.stdout")).unwrap(),
        "SPLIT_DISTINCT_STOPS_PASS\n"
    );
    assert_eq!(
        std::fs::read_to_string(new.join("new-java.stderr")).unwrap(),
        ""
    );
    for name in ["OldImpl", "OldExtender", "SplitCompatibilityDriver"] {
        assert_eq!(
            std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap(),
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap(),
            "old binary changed after new driver compile"
        );
    }
}

const OLD_IMPLEMENTER: &str = "package nts.gen; public final class OldImpl implements Face$Face { public double count; public void step(double n) { count += n; } }";
const OLD_SUBCLASS: &str = "package nts.gen; public final class OldExtender extends Face { public double count; public void step(double n) { count += n; } }";
const OLD_DRIVER: &str = r#"package nts.gen; public final class SplitCompatibilityDriver {
  public static void main(String[] args) {
    OldImpl a = new OldImpl(); a.step(3); Program.invoke_iface(a, 7);
    if (a.count != 10) throw new AssertionError("old companion implementer");
    OldExtender b = new OldExtender(); b.step(3); Program.invoke_iface(b, 7);
    if (b.count != 10) throw new AssertionError("old abstract-class subclass");
    Good good = new Good(); good.step(3); Program.invoke_iface(good, 7);
    if (good.n$count != 10) throw new AssertionError("unrelated generated implementer");
    Solo solo = new Solo(); solo.step(3); Program.invoke_iface(solo, 7);
    if (solo.n$count != 10) throw new AssertionError("interface-only generated implementer");
    System.out.println("SPLIT_OLD_BINARIES_PASS");
  }
}"#;
const NEW_DRIVER: &str = r#"package nts.gen; public final class SplitDriver {
  interface Action { void run(); }
  static void refused(Action action, String original) {
    try { action.run(); throw new AssertionError("did not refuse"); }
    catch (Throwable error) {
      if (error.getMessage() == null || !error.getMessage().contains(original)) throw new AssertionError(error);
    }
  }
  public static void main(String[] args) {
    Bad bad = new Bad();
    refused(() -> bad.step(1), "`Bad#step` was refused:");
    refused(() -> Program.invoke_iface(bad, 1), "`Bad#step@Face` was refused:");
    System.out.println("SPLIT_DISTINCT_STOPS_PASS");
  }
}"#;

fn diamond_fixture(bad: bool, transitive: bool) -> Program {
    let mut program = split_fixture(bad, false);
    let root = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Face")
        .unwrap()
        .clone();
    for (id, name) in [(8, "LeftFace"), (9, "RightFace"), (10, "MiddleFace")] {
        if id == 10 && !transitive {
            continue;
        }
        let mut face = root.clone();
        face.name = name.into();
        face.types = vec![TypeId(id)];
        face.fields[0].name = PropertyKey::Name(format!("state{id}"));
        face.fields[0].declared_by = Some(TypeId(id));
        face.fields.extend((0..id - 7).map(|at| Field {
            name: PropertyKey::Name(format!("extra{id}_{at}")),
            ty: HirType::NUMBER,
            written: None,
            declared_by: Some(TypeId(id)),
            readonly: false,
        }));
        let parent = if id == 8 && transitive { 10 } else { 2 };
        face.interfaces = vec![TypeId(parent)];
        program.interface_identities.push(InterfaceIdentity {
            symbol: id,
            name: name.into(),
            types: vec![TypeId(id)],
            names: std::collections::BTreeMap::default(),
            parents: [(TypeId(id), vec![TypeId(parent)])].into(),
        });
        program.layouts.push(face);
    }
    let solo = program
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "Solo")
        .unwrap();
    solo.interfaces.extend([TypeId(8), TypeId(9)]);
    program
}

fn diamond_surfaces(program: &Program, transitive: bool) {
    let facts = JvmProgram::new(program);
    let root = facts.layout(TypeId(2)).unwrap();
    assert!(facts.is_split(root));
    assert!(facts.guarded_default(root, 83));
    let output = emit(program);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    let internal = guarded_members::internal_name(83);
    for (id, name) in [(8, "LeftFace"), (9, "RightFace"), (10, "MiddleFace")] {
        if id == 10 && !transitive {
            continue;
        }
        let face = facts.layout(TypeId(id)).unwrap();
        assert!(facts.declared_proved(face));
        assert!(
            facts.is_split(face),
            "normal cached split prerequisite: {name}"
        );
        assert!(!hierarchy::is_interface(&facts, face));
        assert_eq!(face.methods[83].as_deref(), Some("Face#step"));
        assert!(!facts.guarded_default(face, 83));
        let companion = parsed(&output, &format!("nts/gen/{name}$Face"));
        let parent = if id == 8 && transitive {
            "MiddleFace"
        } else {
            "Face"
        };
        assert!(
            companion
                .interfaces
                .contains(&format!("nts/gen/{parent}$Face"))
        );
        assert!(companion.methods.iter().any(|m| m.name == "step"
            && m.descriptor == "(D)V"
            && m.access & access::ABSTRACT != 0));
        assert!(
            companion.methods.iter().all(|m| m.name != internal),
            "must inherit without any abstract or concrete internal redeclaration"
        );
        let physical = parsed(&output, &format!("nts/gen/{name}"));
        assert!(physical.methods.iter().any(|m| m.name == internal
            && m.descriptor == "(D)V"
            && m.access & access::ABSTRACT == 0));
    }
    let root_class = parsed(&output, "nts/gen/Face$Face");
    assert_eq!(
        root_class
            .methods
            .iter()
            .filter(|m| m.name == internal && m.access & access::ABSTRACT == 0)
            .count(),
        1
    );
}

#[test]
fn sibling_and_transitive_companions_inherit_one_default_in_both_layout_orders() {
    for transitive in [false, true] {
        let mut program = diamond_fixture(true, transitive);
        diamond_surfaces(&program, transitive);
        program.layouts.reverse();
        diamond_surfaces(&program, transitive);
    }
}

#[test]
fn unrelated_interface_roots_cannot_share_a_new_internal_default() {
    let mut program = diamond_fixture(true, false);
    let identity = program
        .interface_identities
        .iter_mut()
        .find(|identity| identity.symbol == 8)
        .unwrap();
    identity.parents.insert(TypeId(8), Vec::new());
    program
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "LeftFace")
        .unwrap()
        .interfaces
        .clear();
    let facts = JvmProgram::new(&program);
    assert!(facts.is_split(facts.layout(TypeId(8)).unwrap()));
    assert_eq!(
        facts.guarded_member(83),
        None,
        "same abstract Func is not ancestry authority"
    );
    assert!(
        !emit(&program).is_complete(),
        "uncovered named-body conflict must remain refused"
    );
    // Ordinary interfaces currently emit no parent edges. A HIR-only relation
    // cannot license inheritance of an internal default absent from classbytes.
    for layout in &mut program.layouts {
        if layout
            .types
            .iter()
            .any(|ty| [TypeId(2), TypeId(8), TypeId(9)].contains(ty))
        {
            layout.fields.clear();
        }
    }
    let direct = JvmProgram::new(&program);
    assert!(hierarchy::is_interface(
        &direct,
        direct.layout(TypeId(8)).unwrap()
    ));
    assert_eq!(direct.guarded_member(83), None);
}

const DIAMOND_IMPL: &str = "package nts.gen; public final class DiamondImpl implements LeftFace$Face, RightFace$Face { public double count; public void step(double n) { count += n; } }";
const DIAMOND_DRIVER: &str = r#"package nts.gen; public final class DiamondDriver {
  public static void main(String[] args) {
    DiamondImpl a = new DiamondImpl(); a.step(3); Program.invoke_iface(a, 7);
    if (a.count != 10) throw new AssertionError("old sibling companion implementer");
    System.out.println("DIAMOND_OLD_BINARIES_PASS");
  }
}"#;

#[test]
fn old_sibling_companion_implementer_and_root_caller_binaries_remain_compatible() {
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let dir = directory();
    let old = dir.join("diamond-old");
    let new = dir.join("diamond-new");
    let old_program = diamond_fixture(false, false);
    let new_program = diamond_fixture(true, false);
    diamond_surfaces(&new_program, false);
    write_classes(&old, &old_program);
    write_classes(&new, &new_program);
    std::fs::write(old.join("DiamondImpl.java"), DIAMOND_IMPL).unwrap();
    std::fs::write(old.join("DiamondDriver.java"), DIAMOND_DRIVER).unwrap();
    command(
        &javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "DiamondImpl.java",
            "DiamondDriver.java",
        ],
        &old,
        "diamond-old-javac",
    );
    for name in ["DiamondImpl", "DiamondDriver"] {
        let bytes = std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap();
        std::fs::write(new.join(format!("nts/gen/{name}.class")), bytes).unwrap();
    }
    for (path, label) in [(&old, "diamond-old-java"), (&new, "diamond-new-java")] {
        command(
            &java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.DiamondDriver",
            ],
            path,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stdout"))).unwrap(),
            "DIAMOND_OLD_BINARIES_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
    for name in ["DiamondImpl", "DiamondDriver"] {
        assert_eq!(
            std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap(),
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap()
        );
    }
}
