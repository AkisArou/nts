//! Source-interface method ownership is separate from physical JVM inheritance.
//! All programs here are owned HIR; no frontend or preparation invocation.
use std::path::{Path, PathBuf};

use nts_core::hir::{
    Callee, ClassIdentity, Field, Func, HirType, InterfaceIdentity, Layout, ManagedType, Op,
    OpKind, Program, SignatureFace, Terminator, ValueId,
};
use nts_jvm_emitter::{VType, class::access};
use nts_semantic_schema::{PropertyKey, TypeId};

use super::{CLASS_REASON, FACE_REASON, add_bad, body, command, fixture, parsed, push};
use crate::{JvmProgram, emit, guarded_members, hierarchy, types};

const CONTRACT: usize = 102;
const CLASS: usize = 97;
const ABI: &str = "(Lnts/gen/erased/Callable;)V";

fn object(ty: u32) -> HirType {
    HirType::Managed(ManagedType::Object(TypeId(ty)))
}

fn callback(func: &mut Func, target: Option<&str>, virtual_call: bool) {
    func.params[1].ty = object(20);
    func.values = func
        .params
        .iter()
        .enumerate()
        .map(|(at, p)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: p.ty.clone(),
            origin: p.origin.clone(),
        })
        .collect();
    func.blocks[0].ops.clear();
    func.blocks[0].terminator = Terminator::Return(None);
    if let Some(target) = target {
        push(
            func,
            OpKind::Call {
                callee: Callee::Direct(target.into()),
                args: vec![ValueId(0), ValueId(1)],
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
                args: vec![ValueId(0), ValueId(1)],
                frame: None,
            },
            HirType::Void,
        );
    }
}

fn caller(name: &str, receiver: u32, slot: usize, declared: &str) -> Func {
    let mut func = body(name, receiver);
    callback(&mut func, None, false);
    func.exported = true;
    push(
        &mut func,
        OpKind::Call {
            callee: Callee::Virtual {
                slot: u32::try_from(slot).unwrap(),
                declared: declared.into(),
            },
            args: vec![ValueId(0), ValueId(1)],
            frame: None,
        },
        HirType::Void,
    );
    func
}

fn stateful(program: &mut Program) {
    let face = program
        .layouts
        .iter_mut()
        .find(|l| l.name == "Face")
        .unwrap();
    face.fields = (0..4)
        .map(|at| Field {
            name: PropertyKey::Name(format!("contract_state{at}")),
            ty: HirType::NUMBER,
            written: None,
            declared_by: Some(TypeId(2)),
            readonly: false,
        })
        .collect();
    program.interface_identities.push(InterfaceIdentity {
        symbol: 2,
        name: "Face".into(),
        types: vec![TypeId(2)],
        names: std::collections::BTreeMap::default(),
        parents: [(TypeId(2), Vec::new())].into(),
    });
    // A live field read requires all four fields on this physical class.
    // Other source implementers do not hold those fields: normal split
    // planning must reject its companion instead of forcing one for this test.
    let mut read = body("read_contract_state", 2);
    read.params.truncate(1);
    read.values.truncate(1);
    read.exported = true;
    read.return_type = HirType::NUMBER;
    let value = push(
        &mut read,
        OpKind::FieldGet {
            object: ValueId(0),
            field: 0,
        },
        HirType::NUMBER,
    );
    read.blocks[0].terminator = Terminator::Return(Some(value));
    program.funcs.push(read);
}

fn remap(program: &mut Program) {
    for layout in &mut program.layouts {
        let old = std::mem::take(&mut layout.methods);
        layout.methods = vec![None; CONTRACT + 1];
        // The original physical interface named this slot from Face#step.
        // A class contract does not provide that physical-interface fallback:
        // retain the already-proved original source step as the healthy row,
        // rather than using its adapter's distinct generated member spelling.
        layout.methods[CONTRACT] = old.first().cloned().flatten().map(|entry| {
            program
                .identity_projections
                .get(&entry)
                .cloned()
                .unwrap_or(entry)
        });
        layout.methods[CLASS] = old.get(1).cloned().flatten();
    }
    for proof in program.guarded_dispatch.values_mut() {
        proof.slots = proof
            .slots
            .iter()
            .map(|s| u32::try_from(if *s == 0 { CONTRACT } else { CLASS }).unwrap())
            .collect();
    }
    for func in &mut program.funcs {
        for op in &mut func.values {
            if let OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } = &mut op.kind
            {
                *slot = u32::try_from(if *slot == 0 { CONTRACT } else { CLASS }).unwrap();
            }
        }
    }
}

fn pair() -> (Program, Program) {
    let mut control = fixture(false);
    for func in &mut control.funcs {
        let target = control.identity_projections.get(&func.name).cloned();
        let virtual_call = func.name == "invoke_iface";
        callback(func, target.as_deref(), virtual_call);
    }
    stateful(&mut control);
    control.layouts.push(Layout {
        types: vec![TypeId(20)],
        name: "Callback".into(),
        fields: Vec::new(),
        methods: Vec::new(),
        base: None,
        interfaces: Vec::new(),
    });
    control.signature_faces.insert(
        TypeId(20),
        SignatureFace {
            params: Vec::new(),
            returns: Some(HirType::Void),
        },
    );
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
    add_bad(&mut subject, &class, &projected);
    remap(&mut control);
    remap(&mut subject);
    subject.funcs.extend([
        caller("invoke_actual_contract", 4, CONTRACT, "Face#step"),
        caller("invoke_actual_class", 4, CLASS, "Base#step"),
    ]);
    (control, subject)
}

fn assert_actual_conflict(facts: &JvmProgram<'_>) {
    let bad = facts.layout(TypeId(4)).unwrap();
    assert_eq!(bad.methods[CONTRACT].as_deref(), Some(super::FACE_STOP));
    assert_eq!(bad.methods[CLASS].as_deref(), Some(super::CLASS_STOP));
    for slot in [CLASS, CONTRACT] {
        assert_eq!(
            hierarchy::original_declared_member(facts, bad, slot).as_deref(),
            Some("step")
        );
        assert!(
            !facts
                .raising_members
                .contains_key(&u32::try_from(slot).unwrap())
        );
        let target = facts
            .funcs
            .iter()
            .find(|f| Some(f.name.as_str()) == bad.methods[slot].as_deref())
            .unwrap();
        assert_eq!(
            crate::instance_descriptor(types::DEFAULT_PACKAGE, facts, target).as_deref(),
            Some(ABI)
        );
    }
    assert_eq!(
        facts.layout(TypeId(0)).unwrap().methods[CONTRACT].as_deref(),
        Some("Base#step")
    );
    assert_eq!(
        facts.layout(TypeId(3)).unwrap().methods[CONTRACT].as_deref(),
        Some("Good#step")
    );
}

fn assert_physical(program: &Program, qualified: bool) {
    let facts = JvmProgram::new(program);
    let face = facts.layout(TypeId(2)).unwrap();
    assert_eq!(face.fields.len(), 4);
    assert!(!hierarchy::is_interface(&facts, face));
    assert!(
        !facts.is_split(face),
        "must exercise the actual non-split class-contract domain"
    );
    assert!(facts.declared_proved(face));
    assert_eq!(
        types::reference_class(types::DEFAULT_PACKAGE, &facts, face),
        "nts/gen/Face"
    );
    assert_eq!(
        types::vtype(types::Shape::of(&facts), &object(2)),
        Some(VType::Object("nts/gen/Face".into()))
    );
    if facts.layout(TypeId(4)).is_some() {
        assert_actual_conflict(&facts);
    }
    assert_eq!(facts.guarded_member(CONTRACT).is_some(), qualified);
    if qualified {
        assert_eq!(
            types::vtype(types::Shape::of(&facts), &object(4)),
            Some(VType::Object("nts/gen/Bad".into()))
        );
        assert!(facts.guarded_default(face, CONTRACT));
    }
}

fn method<'a>(
    class: &'a nts_jvm_emitter::read::ClassFile,
    name: &str,
    descriptor: &str,
) -> &'a nts_jvm_emitter::read::Member {
    let matches: Vec<_> = class
        .methods
        .iter()
        .filter(|m| m.name == name && m.descriptor == descriptor)
        .collect();
    assert_eq!(matches.len(), 1, "duplicate/missing {name}{descriptor}");
    matches[0]
}

#[test]
fn owned_class_contract_has_class_receiver_calls_and_two_distinct_entries() {
    for reverse in [false, true] {
        let (control, mut subject) = pair();
        if reverse {
            subject.layouts.reverse();
            subject.funcs.reverse();
        }
        assert_physical(&control, false);
        assert_physical(&subject, true);
        let output = emit(&subject);
        assert!(output.is_complete(), "{:?}", output.diagnostics);
        let face = parsed(&output, "nts/gen/Face");
        assert_eq!(face.access & access::INTERFACE, 0);
        assert_ne!(face.access & access::ABSTRACT, 0);
        assert_eq!(face.fields.len(), 4);
        assert_ne!(method(&face, "step", ABI).access & access::ABSTRACT, 0);
        let internal = guarded_members::internal_name(CONTRACT);
        let wrapper = method(&face, &internal, ABI);
        assert_eq!(wrapper.access & access::ABSTRACT, 0);
        assert!(wrapper.code.as_ref().unwrap().bytes.contains(&0xb6));
        let bad = parsed(&output, "nts/gen/Bad");
        assert_eq!(bad.super_name.as_deref(), Some("nts/gen/Base"));
        assert!(!bad.interfaces.contains(&"nts/gen/Face".into()));
        assert!(
            method(&bad, "step", ABI)
                .code
                .as_ref()
                .unwrap()
                .bytes
                .contains(&0xb8)
        );
        assert!(
            method(&bad, &internal, ABI)
                .code
                .as_ref()
                .unwrap()
                .bytes
                .contains(&0xb8)
        );
        let program = parsed(&output, "nts/gen/Program");
        for (name, receiver) in [
            ("invoke_iface", "Face"),
            ("invoke_actual_contract", "Bad"),
            ("invoke_actual_class", "Bad"),
        ] {
            let descriptor = format!("(Lnts/gen/{receiver};Lnts/gen/erased/Callable;)V");
            let code = &method(&program, name, &descriptor)
                .code
                .as_ref()
                .unwrap()
                .bytes;
            assert_eq!(
                code[2], 0xb6,
                "actual class receiver must use invokevirtual"
            );
        }
    }
}

fn refused(case: &str, program: &Program) {
    println!("CLASS_CONTRACT_NEGATIVE_CASE {case}");
    let facts = JvmProgram::new(program);
    assert_actual_conflict(&facts);
    assert_eq!(facts.guarded_member(CONTRACT), None, "{case}");
    let output = emit(program);
    assert!(
        !output
            .classes
            .iter()
            .any(|c| c.binary_name == "nts/gen/Bad")
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

// A same-layout semantic parent is deliberately collapsed by declared_edges.
// Two distinct fielded source layouts are required to test a real cycle.
fn cyclic_contract(original: &Program) -> Program {
    println!("CLASS_CONTRACT_CYCLE_PREMISES distinct_layout_cycle");
    let mut program = original.clone();
    let mut parent = program
        .layouts
        .iter()
        .find(|l| l.name == "Face")
        .unwrap()
        .clone();
    parent.name = "CycleParent".into();
    parent.types = vec![TypeId(21)];
    parent.methods.fill(None);
    for (at, field) in parent.fields.iter_mut().enumerate() {
        field.name = PropertyKey::Name(format!("cycle_parent_state{at}"));
        field.declared_by = Some(TypeId(21));
    }
    program.layouts.push(parent);
    program.interface_identities[0]
        .parents
        .insert(TypeId(2), vec![TypeId(21)]);
    program.interface_identities.push(InterfaceIdentity {
        symbol: 21,
        name: "CycleParent".into(),
        types: vec![TypeId(21)],
        names: std::collections::BTreeMap::default(),
        parents: [(TypeId(21), vec![TypeId(2)])].into(),
    });
    // Keep both physical layouts as classes so no interface leaf can hide
    // the graph edge, and avoid an unrelated split/owner ambiguity.
    let mut read = program
        .funcs
        .iter()
        .find(|f| f.name == "read_contract_state")
        .unwrap()
        .clone();
    read.name = "read_cycle_parent_state".into();
    read.params[0].ty = object(21);
    read.values[0].ty = object(21);
    program.funcs.push(read);
    let facts = JvmProgram::new(&program);
    let face = facts.layout(TypeId(2)).unwrap();
    let parent = facts.layout(TypeId(21)).unwrap();
    assert_ne!(facts.index(face), facts.index(parent));
    for layout in [face, parent] {
        assert!(!hierarchy::is_interface(&facts, layout));
        assert!(!facts.is_split(layout));
        assert!(!facts.declared_proved(layout));
    }
    program
}

#[test]
fn class_contract_requires_unique_owned_abstract_interface_identity() {
    let (_, original) = pair();
    let mut missing = original.clone();
    missing.interface_identities.clear();
    refused("missing", &missing);
    let mut unknown = original.clone();
    unknown.interface_identities[0].parents.clear();
    refused("unknown", &unknown);
    let cycle = cyclic_contract(&original);
    refused("distinct_layout_cycle", &cycle);
    let mut duplicate_identity = original.clone();
    let mut duplicate = duplicate_identity.interface_identities[0].clone();
    duplicate.symbol = 200;
    duplicate_identity.interface_identities.push(duplicate);
    refused("duplicate_identity", &duplicate_identity);
    let mut nominal = original.clone();
    nominal.classes.push(ClassIdentity {
        symbol: 99,
        name: "Face".into(),
        types: vec![TypeId(2)],
    });
    refused("nominal", &nominal);
    let mut wrong_receiver = original.clone();
    let func = wrong_receiver
        .funcs
        .iter_mut()
        .find(|f| f.name == "Face#step")
        .unwrap();
    func.params[0].ty = object(0);
    func.values[0].ty = object(0);
    refused("wrong_receiver", &wrong_receiver);
    let mut concrete = original.clone();
    concrete
        .funcs
        .iter_mut()
        .find(|f| f.name == "Face#step")
        .unwrap()
        .abstract_declaration = false;
    refused("concrete", &concrete);
    let mut ambiguous = original.clone();
    let mut other = ambiguous
        .layouts
        .iter()
        .find(|l| l.name == "Face")
        .unwrap()
        .clone();
    other.name = "OtherContract".into();
    other.types = vec![TypeId(21)];
    other.methods[CONTRACT] = Some("OtherContract#step".into());
    for field in &mut other.fields {
        field.declared_by = Some(TypeId(21));
    }
    ambiguous.layouts.push(other);
    let mut contract = body("OtherContract#step", 21);
    callback(&mut contract, None, false);
    contract.abstract_declaration = true;
    ambiguous.funcs.push(contract);
    ambiguous.interface_identities.push(InterfaceIdentity {
        symbol: 21,
        name: "OtherContract".into(),
        types: vec![TypeId(21)],
        names: std::collections::BTreeMap::default(),
        parents: [(TypeId(21), Vec::new())].into(),
    });
    refused("ambiguous", &ambiguous);
}

#[test]
fn class_contract_keeps_mixed_roots_foreign_and_incomplete_families_closed() {
    let (_, original) = pair();
    let mut foreign = original.clone();
    foreign
        .layouts
        .iter_mut()
        .find(|l| l.name == "Face")
        .unwrap()
        .name = "foreign/Face".into();
    assert!(nts_core::hir::runtime::is_foreign_layout_name(
        "foreign/Face"
    ));
    refused("foreign", &foreign);
    let mut mixed = original.clone();
    let mut direct = mixed
        .layouts
        .iter()
        .find(|l| l.name == "Face")
        .unwrap()
        .clone();
    direct.name = "DirectFace".into();
    direct.types = vec![TypeId(22)];
    direct.fields.clear();
    direct.methods[CONTRACT] = Some("DirectFace#step".into());
    mixed.layouts.push(direct);
    mixed
        .layouts
        .iter_mut()
        .find(|l| l.name == "Bad")
        .unwrap()
        .interfaces
        .push(TypeId(22));
    let mut contract = body("DirectFace#step", 22);
    callback(&mut contract, None, false);
    contract.abstract_declaration = true;
    mixed.funcs.push(contract);
    refused("mixed", &mixed);
    let mut uncovered = original.clone();
    uncovered.guarded_dispatch.remove(super::FACE_STOP);
    refused("uncovered", &uncovered);
    let mut wrong_abi = original.clone();
    let func = wrong_abi
        .funcs
        .iter_mut()
        .find(|f| f.name == "Solo#step")
        .unwrap();
    func.params[1].ty = HirType::NUMBER;
    func.values[1].ty = HirType::NUMBER;
    refused("wrong_abi", &wrong_abi);
    let mut no_edge = original.clone();
    no_edge
        .layouts
        .iter_mut()
        .find(|l| l.name == "Base")
        .unwrap()
        .interfaces
        .clear();
    no_edge
        .layouts
        .iter_mut()
        .find(|l| l.name == "Bad")
        .unwrap()
        .interfaces
        .clear();
    refused("no_edge", &no_edge);
}

const DECLINE_DRIVER: &str = r#"package nts.gen; public final class DeclinedContractDriver {
 public static void main(String[] args) throws Exception {
  var method = Program.class.getMethod(args[0], Bad.class);
  if (method.getReturnType() != Face.class || !method.isSynthetic()) throw new AssertionError("decline ABI changed");
  try { method.invoke(null, new Bad()); throw new AssertionError("forbidden store/cast returned successfully"); }
  catch (java.lang.reflect.InvocationTargetException error) {
   Throwable cause = error.getCause();
   String expected = "`" + args[0] + "` was declined: " + args[1];
   if (!(cause instanceof nts.rt.NtsRefusal) || !cause.getMessage().contains(expected)) throw new AssertionError(cause);
  }
  System.out.println("CLASS_CONTRACT_NAMED_DECLINE_PASS");
 }
}"#;

fn retain_negative(path: &Path, program: &Program, output: &crate::Emitted) {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("prepared-program.txt"), format!("{program:#?}")).unwrap();
    std::fs::write(
        path.join("emission-diagnostics.txt"),
        format!("{:#?}", output.diagnostics),
    )
    .unwrap();
    for class in &output.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, &class.bytes).unwrap();
    }
    std::fs::write(path.join("nts-runtime.jar"), crate::runtime_jar().as_ref()).unwrap();
}

fn assert_declined_method(output: &crate::Emitted, name: &str, field_cast: bool) -> String {
    assert!(!output.is_complete());
    let diagnostic = output
        .diagnostics
        .iter()
        .find(|d| d.message.contains(name))
        .expect("named forbidden conversion must be refused");
    let expected = if field_cast {
        "interface field accessor dispatch requires JVM stateful interfaces"
    } else {
        "does not extend that class"
    };
    assert!(
        diagnostic.message.contains(expected),
        "{:?}",
        output.diagnostics
    );
    let class = parsed(output, "nts/gen/Program");
    let stub = method(&class, name, "(Lnts/gen/Bad;)Lnts/gen/Face;");
    assert_eq!(
        stub.access,
        access::PUBLIC | access::STATIC | access::SYNTHETIC
    );
    assert!(
        stub.code.is_some(),
        "named decline must have a throwing body"
    );
    diagnostic.message.clone()
}

fn forbidden_conversion(original: &Program, field_cast: bool) -> (Program, String) {
    let mut program = original.clone();
    let mut func = body(
        if field_cast {
            "forbidden_class_cast"
        } else {
            "forbidden_class_store"
        },
        4,
    );
    func.params.truncate(1);
    func.values.truncate(1);
    func.exported = true;
    func.return_type = object(2);
    let value = if field_cast {
        push(
            &mut func,
            OpKind::FieldView {
                value: ValueId(0),
                source: TypeId(4),
                face: TypeId(2),
            },
            object(2),
        )
    } else {
        ValueId(0)
    };
    func.blocks[0].terminator = Terminator::Return(Some(value));
    let name = func.name.clone();
    program.funcs.push(func);
    (program, name)
}

#[test]
fn class_contract_name_does_not_license_cross_class_store_or_field_cast() {
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/guarded-class-contract-negative-{}-{stamp}",
        std::process::id()
    ));
    println!(
        "GUARDED_CLASS_CONTRACT_NEGATIVE_ARTIFACTS {}",
        directory.display()
    );
    let (_, original) = pair();
    let mut driver = None;
    for field_cast in [false, true] {
        let (program, name) = forbidden_conversion(&original, field_cast);
        let output = emit(&program);
        let path = directory.join(if field_cast { "field-cast" } else { "store" });
        retain_negative(&path, &program, &output);
        assert_physical(&program, true);
        let reason = assert_declined_method(&output, &name, field_cast);
        if let Some(bytes) = &driver {
            std::fs::write(path.join("nts/gen/DeclinedContractDriver.class"), bytes).unwrap();
        } else {
            std::fs::write(path.join("DeclinedContractDriver.java"), DECLINE_DRIVER).unwrap();
            command(
                &javac,
                &[
                    "-cp",
                    ".:nts-runtime.jar",
                    "-d",
                    ".",
                    "DeclinedContractDriver.java",
                ],
                &path,
                "decline-javac",
            );
            driver =
                Some(std::fs::read(path.join("nts/gen/DeclinedContractDriver.class")).unwrap());
        }
        command(
            &java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.DeclinedContractDriver",
                &name,
                &reason,
            ],
            &path,
            "decline-java",
        );
        assert_eq!(
            std::fs::read_to_string(path.join("decline-java.stdout")).unwrap(),
            "CLASS_CONTRACT_NAMED_DECLINE_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join("decline-java.stderr")).unwrap(),
            ""
        );
        assert_eq!(
            std::fs::read(path.join("nts/gen/DeclinedContractDriver.class")).unwrap(),
            *driver.as_ref().unwrap()
        );
    }
}

fn preserve(path: &Path, program: &Program, qualified: bool) {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("prepared-program.txt"), format!("{program:#?}")).unwrap();
    let output = emit(program);
    std::fs::write(
        path.join("emission-diagnostics.txt"),
        format!("{:#?}", output.diagnostics),
    )
    .unwrap();
    for class in &output.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, &class.bytes).unwrap();
    }
    std::fs::write(path.join("nts-runtime.jar"), crate::runtime_jar().as_ref()).unwrap();
    assert_physical(program, qualified);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
}

const IMPLEMENTER: &str = "package nts.gen; public final class OldContractSubclass extends Face { public int calls; @Override public void step(nts.gen.erased.Callable cb) { calls++; } }";
const DRIVER: &str = r#"package nts.gen; public final class ContractOverrideDriver {
 public static void main(String[] args) {
  OldContractSubclass value = new OldContractSubclass(); value.step(null); Program.invoke_iface(value, null);
  if (value.calls != 2) throw new AssertionError("old class contract override bypassed: " + value.calls);
  System.out.println("CLASS_CONTRACT_OLD_BINARIES_PASS");
 }
}"#;
const STOP_DRIVER: &str = r#"package nts.gen; public final class ContractStopDriver {
 public static void main(String[] args) {
  Bad value = new Bad(); String ordinary = "", contract = "";
  try { Program.invoke_actual_class(value, null); } catch (nts.rt.NtsRefusal e) { ordinary = e.getMessage(); }
  try { Program.invoke_actual_contract(value, null); } catch (nts.rt.NtsRefusal e) { contract = e.getMessage(); }
  if (!ordinary.contains("the actual source operation is unsupported")) throw new AssertionError(ordinary);
  if (!contract.contains("it calls Bad#step, which was refused")) throw new AssertionError(contract);
  if (ordinary.equals(contract)) throw new AssertionError("distinct reasons collapsed");
  System.out.println("CLASS_CONTRACT_DISTINCT_STOPS_PASS");
 }
}"#;

#[test]
fn class_contract_old_subclass_binary_and_actual_receiver_named_stops_execute() {
    assert!(STOP_DRIVER.contains(CLASS_REASON) && STOP_DRIVER.contains(FACE_REASON));
    let javac = super::common::tool("javac").expect("javac is required");
    let java = super::common::tool("java").expect("java is required");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/guarded-class-contract-{}-{stamp}",
        std::process::id()
    ));
    println!("GUARDED_CLASS_CONTRACT_ARTIFACTS {}", directory.display());
    let old = directory.join("old");
    let new = directory.join("new");
    let (control, subject) = pair();
    preserve(&old, &control, false);
    preserve(&new, &subject, true);
    std::fs::write(old.join("OldContractSubclass.java"), IMPLEMENTER).unwrap();
    std::fs::write(old.join("ContractOverrideDriver.java"), DRIVER).unwrap();
    command(
        &javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldContractSubclass.java",
            "ContractOverrideDriver.java",
        ],
        &old,
        "old-javac",
    );
    for name in ["OldContractSubclass", "ContractOverrideDriver"] {
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
                "nts.gen.ContractOverrideDriver",
            ],
            path,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stdout"))).unwrap(),
            "CLASS_CONTRACT_OLD_BINARIES_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
    for name in ["OldContractSubclass", "ContractOverrideDriver"] {
        assert_eq!(
            std::fs::read(old.join(format!("nts/gen/{name}.class"))).unwrap(),
            std::fs::read(new.join(format!("nts/gen/{name}.class"))).unwrap()
        );
    }
    std::fs::write(new.join("ContractStopDriver.java"), STOP_DRIVER).unwrap();
    command(
        &javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "ContractStopDriver.java",
        ],
        &new,
        "stop-javac",
    );
    command(
        &java,
        &[
            "-Xverify:all",
            "-cp",
            ".:nts-runtime.jar",
            "nts.gen.ContractStopDriver",
        ],
        &new,
        "stop-java",
    );
    assert_eq!(
        std::fs::read_to_string(new.join("stop-java.stdout")).unwrap(),
        "CLASS_CONTRACT_DISTINCT_STOPS_PASS\n"
    );
    assert_eq!(
        std::fs::read_to_string(new.join("stop-java.stderr")).unwrap(),
        ""
    );
}
