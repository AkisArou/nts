//! Small owned-HIR controls; no frontend/native capture in this module.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::path::{Path, PathBuf};

use nts_core::hir::{
    Absent, BinOp, Block, Callee, Field, Func, GuardedDispatch, HirType, Layout, ManagedType, Op,
    OpKind, Param, ParamShape, Program, Terminator, ValueId, facts::Facts,
};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{GeneratedReason, Origin, PropertyKey, TypeId};

use super::{JvmProgram, emit, guarded_members, hierarchy};

#[path = "../tests/common/mod.rs"]
mod common;

const FACE_STOP: &str = "stop-interface";
const CLASS_STOP: &str = "stop-class";
const FACE_ORIGINAL: &str = "Bad#step@Face";
const CLASS_ORIGINAL: &str = "Bad#step";
const FACE_REASON: &str = "it calls Bad#step, which was refused";
const CLASS_REASON: &str = "the actual source operation is unsupported";

fn body(name: &str, receiver: u32) -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(10, 20),
    });
    let params: Vec<_> = [
        HirType::Managed(ManagedType::Object(TypeId(receiver))),
        HirType::NUMBER,
    ]
    .into_iter()
    .enumerate()
    .map(|(at, ty)| Param {
        name: format!("p{at}"),
        ty,
        origin: origin.clone(),
        shape: ParamShape::Ordinary,
        known: Facts::TOP,
        written: None,
    })
    .collect();
    let values = params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    Func {
        name: name.into(),
        params,
        return_type: HirType::Void,
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(None),
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        written_return: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Undefined,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    }
}

fn push(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(Op {
        kind,
        ty,
        origin: func.origin.clone(),
    });
    func.blocks[0].ops.push(id);
    id
}

fn projection(name: &str, receiver: u32, target: &str) -> Func {
    let mut func = body(name, receiver);
    func.origin = Origin::generated(func.origin.location, GeneratedReason::AbiProjection);
    func.result_absent = Absent::Impossible;
    for param in &mut func.params {
        param.origin = func.origin.clone();
    }
    push(
        &mut func,
        OpKind::Call {
            callee: Callee::Direct(target.into()),
            args: vec![ValueId(0), ValueId(1)],
            frame: None,
        },
        HirType::Void,
    );
    func
}

fn stopped(name: &str, contract: &Func, original: &str, reason: &str) -> Func {
    let mut func = contract.clone();
    func.name = name.into();
    func.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(4)));
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
    func.blocks[0].ops.clear();
    let message = push(
        &mut func,
        OpKind::ConstString(format!("`{original}` was refused: {reason}").into()),
        HirType::Managed(ManagedType::String),
    );
    push(
        &mut func,
        OpKind::Call {
            callee: Callee::External("nts_refused".into()),
            args: vec![message],
            frame: None,
        },
        HirType::Void,
    );
    func.blocks[0].terminator = Terminator::Unreachable;
    func
}

fn layout(name: &str, ty: u32, methods: [Option<&str>; 2], base: Option<u32>) -> Layout {
    Layout {
        types: vec![TypeId(ty)],
        name: name.into(),
        fields: if ty == 2 {
            Vec::new()
        } else {
            vec![Field {
                name: PropertyKey::Name("count".into()),
                ty: HirType::NUMBER,
                written: None,
                declared_by: Some(TypeId(0)),
                readonly: false,
            }]
        },
        methods: methods.map(|name| name.map(str::to_owned)).to_vec(),
        base: base.map(TypeId),
        interfaces: if ty == 0 || ty == 4 {
            vec![TypeId(2)]
        } else {
            Vec::new()
        },
    }
}

fn good_body(name: &str, receiver: u32) -> Func {
    let mut func = body(name, receiver);
    let current = push(
        &mut func,
        OpKind::FieldGet {
            object: ValueId(0),
            field: 0,
        },
        HirType::NUMBER,
    );
    let next = push(
        &mut func,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: current,
            rhs: ValueId(1),
        },
        HirType::NUMBER,
    );
    push(
        &mut func,
        OpKind::FieldSet {
            object: ValueId(0),
            field: 0,
            value: next,
        },
        HirType::Void,
    );
    func
}

fn caller() -> Func {
    let mut func = body("invoke_iface", 2);
    func.exported = true;
    push(
        &mut func,
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
    func
}

fn fixture(bad: bool) -> Program {
    let class_contract = body("Base#step", 0);
    let face_contract = projection("Base#step@Face", 0, "Base#step");
    let mut face = body("Face#step", 2);
    face.abstract_declaration = true;
    let mut program = Program {
        funcs: vec![
            class_contract.clone(),
            face_contract.clone(),
            face,
            good_body("Good#step", 3),
            good_body("Solo#step", 6),
            projection("Good#step@Face", 3, "Good#step"),
            caller(),
        ],
        layouts: vec![
            layout("Face", 2, [Some("Face#step"), None], None),
            layout("Base", 0, [Some("Base#step@Face"), Some("Base#step")], None),
            layout(
                "Good",
                3,
                [Some("Good#step@Face"), Some("Good#step")],
                Some(0),
            ),
        ],
        identity_projections: [
            ("Base#step@Face".into(), "Base#step".into()),
            ("Good#step@Face".into(), "Good#step".into()),
        ]
        .into(),
        ..Program::default()
    };
    let mut solo = layout("Solo", 6, [Some("Solo#step"), None], None);
    solo.interfaces = vec![TypeId(2)];
    solo.fields[0].declared_by = Some(TypeId(6));
    program.layouts.push(solo);
    if bad {
        add_bad(&mut program, &class_contract, &face_contract);
    }
    program
}

fn add_bad(program: &mut Program, class_contract: &Func, face_contract: &Func) {
    program.funcs.extend([
        stopped(FACE_STOP, face_contract, FACE_ORIGINAL, FACE_REASON),
        stopped(CLASS_STOP, class_contract, CLASS_ORIGINAL, CLASS_REASON),
    ]);
    program.layouts.push(layout(
        "Bad",
        4,
        [Some(FACE_STOP), Some(CLASS_STOP)],
        Some(0),
    ));
    for (name, original, contract, reason, slot) in [
        (
            FACE_STOP,
            FACE_ORIGINAL,
            &face_contract.name,
            FACE_REASON,
            0,
        ),
        (
            CLASS_STOP,
            CLASS_ORIGINAL,
            &class_contract.name,
            CLASS_REASON,
            1,
        ),
    ] {
        program.uncompiled.push((original.into(), reason.into()));
        program.guarded_dispatch.insert(
            name.into(),
            GuardedDispatch {
                original: original.into(),
                contract: contract.clone(),
                receiver: TypeId(4),
                slots: [slot].into(),
            },
        );
    }
}

fn parsed(emitted: &super::Emitted, name: &str) -> nts_jvm_emitter::read::ClassFile {
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == name)
        .unwrap();
    nts_jvm_emitter::read::class_file(&class.bytes).unwrap()
}

fn assert_bad_refused(program: &Program) {
    let facts = JvmProgram::new(program);
    assert_eq!(
        facts.guarded_member(0),
        None,
        "unsupported proof must not rename the family"
    );
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
            .any(|diag| diag.message.contains("distinct dispatch bodies")),
        "{:?}",
        output.diagnostics
    );
}

#[test]
fn both_slot_bodies_and_original_public_surface_survive_in_both_layout_orders() {
    for reverse in [false, true] {
        let mut program = fixture(true);
        if reverse {
            program.layouts.reverse();
            program.funcs.reverse();
        }
        let facts = JvmProgram::new(&program);
        let internal = guarded_members::internal_name(0);
        assert_eq!(facts.guarded_member(0), Some(internal.as_str()));
        assert_eq!(hierarchy::slot_member(&facts, 0, "Face#step"), internal);
        assert_eq!(hierarchy::slot_member(&facts, 1, "Base#step"), "step");
        let output = emit(&program);
        assert!(output.is_complete(), "{:?}", output.diagnostics);
        let face = parsed(&output, "nts/gen/Face");
        let plain = face
            .methods
            .iter()
            .find(|method| method.name == "step")
            .unwrap();
        assert_eq!(plain.descriptor, "(D)V");
        assert_ne!(plain.access & nts_jvm_emitter::access::ABSTRACT, 0);
        let added = face
            .methods
            .iter()
            .find(|method| method.name == internal)
            .unwrap();
        assert_eq!(added.descriptor, plain.descriptor);
        assert_eq!(
            added.access & nts_jvm_emitter::access::ABSTRACT,
            0,
            "no new abstract obligation"
        );
        for name in ["nts/gen/Good", "nts/gen/Solo", "nts/gen/Bad"] {
            let class = parsed(&output, name);
            for member in ["step", internal.as_str()] {
                assert_eq!(
                    class
                        .methods
                        .iter()
                        .filter(|method| method.name == member && method.descriptor == "(D)V")
                        .count(),
                    1
                );
            }
        }
    }
}

#[test]
fn adding_a_refused_receiver_does_not_change_the_old_plain_public_surface() {
    let old = emit(&fixture(false));
    let new = emit(&fixture(true));
    assert!(old.is_complete() && new.is_complete());
    for name in ["nts/gen/Face", "nts/gen/Good", "nts/gen/Solo"] {
        let old = parsed(&old, name);
        let new = parsed(&new, name);
        let surface = |class: &nts_jvm_emitter::read::ClassFile| {
            let mut members: Vec<_> = class
                .methods
                .iter()
                .filter(|method| !method.name.starts_with("¢nts$dispatch$"))
                .map(|method| {
                    (
                        method.name.clone(),
                        method.descriptor.clone(),
                        method.access,
                    )
                })
                .collect();
            members.sort();
            members
        };
        assert_eq!(
            surface(&old),
            surface(&new),
            "unrelated receiver changed {name}'s old ABI"
        );
    }
}

#[test]
fn missing_stale_renamed_and_mismatched_certificates_fail_closed() {
    let mut missing = fixture(true);
    missing.guarded_dispatch.clear();
    assert_bad_refused(&missing);
    let mut stale = fixture(true);
    stale
        .guarded_dispatch
        .get_mut(FACE_STOP)
        .unwrap()
        .slots
        .clear();
    assert_bad_refused(&stale);
    let mut receiver = fixture(true);
    receiver
        .guarded_dispatch
        .get_mut(FACE_STOP)
        .unwrap()
        .receiver = TypeId(3);
    assert_bad_refused(&receiver);
    let mut original = fixture(true);
    original
        .guarded_dispatch
        .get_mut(FACE_STOP)
        .unwrap()
        .original = "unknown original".into();
    assert_bad_refused(&original);
    let mut body = fixture(true);
    let target = body
        .funcs
        .iter_mut()
        .find(|func| func.name == FACE_STOP)
        .unwrap();
    let what = target.blocks[0].ops[0];
    target.values[what.0 as usize].kind = OpKind::ConstString("changed reason".into());
    assert_bad_refused(&body);
    let mut renamed = fixture(true);
    renamed
        .funcs
        .iter_mut()
        .find(|func| func.name == FACE_STOP)
        .unwrap()
        .name = "renamed stop".into();
    renamed
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "Bad")
        .unwrap()
        .methods[0] = Some("renamed stop".into());
    assert_bad_refused(&renamed);
    let mut contract = fixture(true);
    contract.funcs.retain(|func| func.name != "Base#step@Face");
    assert_bad_refused(&contract);
}

#[test]
fn a_concrete_interface_row_keeps_the_existing_conflict_boundary() {
    let mut program = fixture(true);
    program
        .funcs
        .iter_mut()
        .find(|func| func.name == "Face#step")
        .unwrap()
        .abstract_declaration = false;
    let facts = JvmProgram::new(&program);
    let face = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Face")
        .unwrap();
    assert!(
        hierarchy::is_interface(&facts, face),
        "concrete methods do not make this a class"
    );
    assert_eq!(
        facts.guarded_member(0),
        None,
        "no new internal static default may bypass an existing Java plain override"
    );
    assert_bad_refused(&program);
}

#[test]
fn an_unrelated_unlicensed_receiver_cannot_be_hidden_by_a_licensed_family() {
    let mut program = fixture(true);
    program.layouts.push(layout(
        "Unlicensed",
        5,
        [Some("unproved-one"), Some("unproved-two")],
        Some(0),
    ));
    program
        .funcs
        .extend([body("unproved-one", 5), body("unproved-two", 5)]);
    let output = emit(&program);
    assert_eq!(JvmProgram::new(&program).guarded_member(0), None);
    assert!(
        output
            .diagnostics
            .iter()
            .any(|diag| diag.message.contains("distinct dispatch bodies"))
    );
}

#[test]
fn reserved_names_do_not_capture_written_lookalikes_and_raising_names_stay_owned() {
    let name = guarded_members::internal_name(0);
    assert!(nts_codegen_common::symbols::dex_can_spell(&name));
    assert_ne!(nts_codegen_common::symbols::jvm_member_name(&name), name);
    let mut program = fixture(true);
    program.raising_members.insert(1, "step@raises".into());
    // Raising separates the public collision already: no additional selector.
    let facts = JvmProgram::new(&program);
    assert_eq!(facts.guarded_member(0), None);
    assert_eq!(hierarchy::slot_member(&facts, 1, CLASS_STOP), "step$raises");
}

#[test]
fn field_family_and_uniform_runtime_slot_authorities_cannot_be_qualified() {
    use nts_core::hir::interface_access::{Entry, Family};
    let mut program = fixture(true);
    program.interface_access.families.push(Family {
        face: TypeId(7),
        member: PropertyKey::Name("x".into()),
        field: Some(0),
        getter: Entry {
            slot: 0,
            declared: "Face#get_x@interface7".into(),
        },
        setter: None,
        raising: vec![Entry {
            slot: 1,
            declared: "Face#get_x@interface7@raises".into(),
        }],
        owners: Vec::new(),
        eager: false,
        pending: false,
        stored_dispatch: true,
    });
    let facts = JvmProgram::new(&program);
    assert_eq!(facts.guarded_member(0), None);
    assert_eq!(
        hierarchy::slot_member(&facts, 0, FACE_STOP),
        "get_x$interface7"
    );
    assert_eq!(
        hierarchy::slot_member(&facts, 1, CLASS_STOP),
        "get_x$interface7$raises"
    );
    let mut uniform = fixture(true);
    uniform.erased_call_slot = Some(0);
    assert_eq!(JvmProgram::new(&uniform).guarded_member(0), None);
}

#[test]
fn externally_bound_java_interface_names_cannot_gain_internal_selectors() {
    let mut program = fixture(true);
    program
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "Face")
        .unwrap()
        .name = "foreign/Face".into();
    assert_eq!(JvmProgram::new(&program).guarded_member(0), None);
}

fn widened_body(name: &str, receiver: u32) -> Func {
    let mut func = body(name, receiver);
    let mut param = func.params[1].clone();
    param.name = "p2".into();
    func.values.push(Op {
        kind: OpKind::Param(2),
        ty: param.ty.clone(),
        origin: param.origin.clone(),
    });
    func.params.push(param);
    func
}

fn widened_projection(name: &str, target: &str, drop: bool) -> Func {
    let mut func = widened_body(name, if name.starts_with("Good") { 3 } else { 0 });
    func.origin = Origin::generated(func.origin.location, GeneratedReason::AbiProjection);
    for param in &mut func.params {
        param.origin = func.origin.clone();
    }
    let mut args = vec![ValueId(0), ValueId(1)];
    if !drop {
        args.push(ValueId(2));
    }
    push(
        &mut func,
        OpKind::Call {
            callee: Callee::Direct(target.into()),
            args,
            frame: None,
        },
        HirType::Void,
    );
    func
}

fn dropped_tail_fixture(reverse: bool) -> Program {
    let class = widened_body("Base#step", 0);
    let face_contract = widened_projection("Base#step@Face", "Base#step", false);
    let mut face = widened_body("Face#step", 2);
    face.abstract_declaration = true;
    let mut invoke = widened_body("invoke_iface", 2);
    invoke.exported = true;
    push(
        &mut invoke,
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
    let mut program = Program {
        funcs: vec![
            class.clone(),
            face_contract.clone(),
            face,
            good_body("Good#step", 3),
            widened_projection("Good#step@Face", "Good#step", true),
            invoke,
        ],
        layouts: vec![
            layout("Face", 2, [Some("Face#step"), None], None),
            layout("Base", 0, [Some("Base#step@Face"), Some("Base#step")], None),
            layout(
                "Good",
                3,
                [Some("Good#step@Face"), Some("Good#step")],
                Some(0),
            ),
        ],
        identity_projections: [
            ("Base#step@Face".into(), "Base#step".into()),
            ("Good#step@Face".into(), "Good#step".into()),
        ]
        .into(),
        ..Program::default()
    };
    add_bad(&mut program, &class, &face_contract);
    if reverse {
        for layout in &mut program.layouts {
            layout.methods.swap(0, 1);
        }
        for proof in program.guarded_dispatch.values_mut() {
            proof.slots = proof.slots.iter().map(|slot| 1 - slot).collect();
        }
        for func in &mut program.funcs {
            for op in &mut func.values {
                if let OpKind::Call {
                    callee: Callee::Virtual { slot, .. },
                    ..
                } = &mut op.kind
                {
                    *slot = 1 - *slot;
                }
            }
        }
    }
    program
}

#[test]
fn compatibility_and_dropped_tail_bridge_share_one_ownership_plan_in_both_slot_orders() {
    for reverse in [false, true] {
        let program = dropped_tail_fixture(reverse);
        let output = emit(&program);
        assert!(output.is_complete(), "{:?}", output.diagnostics);
        let class = parsed(&output, "nts/gen/Good");
        let internal = guarded_members::internal_name(usize::from(reverse));
        for (name, descriptor) in [
            ("step", "(D)V"),
            ("step", "(DD)V"),
            (internal.as_str(), "(DD)V"),
        ] {
            assert_eq!(
                class
                    .methods
                    .iter()
                    .filter(|method| method.name == name && method.descriptor == descriptor)
                    .count(),
                1,
                "duplicate/missing ownership for {name}{descriptor}"
            );
        }
        let mut missing = program.clone();
        missing.identity_projections.remove("Good#step@Face");
        let refused = emit(&missing);
        assert!(
            !refused
                .classes
                .iter()
                .any(|class| class.binary_name == "nts/gen/Good")
        );
        assert!(
            refused
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains("distinct dispatch bodies")),
            "unproved dropped-tail bridge was accepted"
        );
    }
}

fn write_classes(directory: &Path, program: &Program) {
    std::fs::create_dir_all(directory).unwrap();
    let output = emit(program);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    for class in output.classes {
        let path = directory.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, class.bytes).unwrap();
    }
    std::fs::write(
        directory.join("nts-runtime.jar"),
        super::runtime_jar().as_ref(),
    )
    .unwrap();
}

fn command(tool: &Path, args: &[&str], directory: &Path, label: &str) {
    let child = crate::toolchain::command(tool)
        .args(args)
        .current_dir(directory)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    let result = child.wait_with_output().unwrap();
    std::fs::write(directory.join(format!("{label}.stdout")), &result.stdout).unwrap();
    std::fs::write(directory.join(format!("{label}.stderr")), &result.stderr).unwrap();
    std::fs::write(
        directory.join(format!("{label}.status")),
        format!(
            "pid={pid} tool={} args={args:?} status={:?}",
            tool.display(),
            result.status
        ),
    )
    .unwrap();
    assert!(
        result.status.success(),
        "{label}: status={:?} stdout={} stderr={}",
        result.status,
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

fn old_binary_controls(java: &Path, javac: &Path, old: &Path, new: &Path) -> Vec<u8> {
    let source = "package nts.gen; public final class OldImpl implements Face { public double count; public void step(double n) { count += n; } }";
    std::fs::write(old.join("OldImpl.java"), source).unwrap();
    std::fs::write(old.join("CompatibilityDriver.java"), COMPATIBILITY_DRIVER).unwrap();
    command(
        javac,
        &[
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldImpl.java",
            "CompatibilityDriver.java",
        ],
        old,
        "old-javac",
    );
    let old_binary = std::fs::read(old.join("nts/gen/OldImpl.class")).unwrap();
    std::fs::write(new.join("nts/gen/OldImpl.class"), &old_binary).unwrap();
    let compatibility_binary =
        std::fs::read(old.join("nts/gen/CompatibilityDriver.class")).unwrap();
    std::fs::write(
        new.join("nts/gen/CompatibilityDriver.class"),
        &compatibility_binary,
    )
    .unwrap();
    for (path, label) in [(old, "old-compatible-java"), (new, "new-compatible-java")] {
        command(
            java,
            &[
                "-Xverify:all",
                "-cp",
                ".:nts-runtime.jar",
                "nts.gen.CompatibilityDriver",
            ],
            path,
            label,
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stdout"))).unwrap(),
            "UNCHANGED_IMPLEMENTERS_PASS\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{label}.stderr"))).unwrap(),
            ""
        );
    }
    assert_eq!(
        std::fs::read(new.join("nts/gen/CompatibilityDriver.class")).unwrap(),
        compatibility_binary,
        "the old-ABI control driver binary changed"
    );
    old_binary
}

#[test]
fn old_java_binary_uses_the_new_default_and_generated_calls_keep_distinct_reasons() {
    let javac = common::tool("javac").expect("javac is a prerequisite, never a silent skip");
    let java = common::tool("java").expect("java is a prerequisite, never a silent skip");
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/tmp")
        .join(format!(
            "guarded-default-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    let old = directory.join("old");
    let new = directory.join("new");
    write_classes(&old, &fixture(false));
    write_classes(&new, &fixture(true));
    println!("GUARDED_DEFAULT_ARTIFACTS {}", directory.display());
    let old_binary = old_binary_controls(&java, &javac, &old, &new);
    std::fs::write(new.join("Driver.java"), DRIVER).unwrap();
    command(
        &javac,
        &["-cp", ".:nts-runtime.jar", "-d", ".", "Driver.java"],
        &new,
        "new-driver-javac",
    );
    assert_eq!(
        std::fs::read(new.join("nts/gen/OldImpl.class")).unwrap(),
        old_binary,
        "the existing implementation binary was recompiled or changed"
    );
    command(
        &java,
        &["-Xverify:all", "-cp", ".:nts-runtime.jar", "nts.gen.Driver"],
        &new,
        "java",
    );
    assert_eq!(
        std::fs::read_to_string(new.join("java.stdout")).unwrap(),
        "COMPAT_AND_DISTINCT_STOPS_PASS\n"
    );
    assert_eq!(
        std::fs::read_to_string(new.join("java.stderr")).unwrap(),
        ""
    );
}

const DRIVER: &str = r#"package nts.gen;
public final class Driver {
  interface Action { void run(); }
  static void refusal(Action action, String original) {
    try { action.run(); throw new AssertionError("did not refuse"); }
    catch (Throwable problem) {
      if (problem.getMessage() == null || !problem.getMessage().contains(original))
        throw new AssertionError("wrong named refusal: " + problem, problem);
    }
  }
  public static void main(String[] args) {
    Bad bad = new Bad();
    refusal(() -> bad.step(1), "`Bad#step` was refused:");
    refusal(() -> Program.invoke_iface(bad, 1), "`Bad#step@Face` was refused:");
    System.out.println("COMPAT_AND_DISTINCT_STOPS_PASS");
  }
}
"#;

const COMPATIBILITY_DRIVER: &str = r#"package nts.gen;
public final class CompatibilityDriver {
  public static void main(String[] args) {
    OldImpl external = new OldImpl(); external.step(3); Program.invoke_iface(external, 7);
    if (external.count != 10) throw new AssertionError("old binary/default hop");
    Good good = new Good(); good.step(3); Program.invoke_iface(good, 7);
    if (good.n$count != 10) throw new AssertionError("unrelated generated implementer");
    Solo solo = new Solo(); solo.step(3); Program.invoke_iface(solo, 7);
    if (solo.n$count != 10) throw new AssertionError("interface-only generated implementer");
    System.out.println("UNCHANGED_IMPLEMENTERS_PASS");
  }
}
"#;

#[path = "guarded_member_tests/split_face.rs"]
mod split_face;

#[path = "guarded_member_tests/concrete_override.rs"]
mod concrete_override;

mod class_contract;
mod ordinary_abstract;
