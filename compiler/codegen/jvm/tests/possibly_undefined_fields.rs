//! Logical optional fields, independently of the future source producer.
//! The Java caller checks values as well as JVM verification and field flags.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8Path;
use nts_core::hir::{
    self, Absent, Block, Field, Func, HirType, InterfaceIdentity, Layout, ManagedType, Op, OpKind,
    Param, Program, Terminator, ValueId,
};
use nts_jvm_emitter::{class::access, read};
use nts_semantic_schema::{Origin, TypeId};
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;

fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}
fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(TypeId(id)))
}
fn optional(payload: &HirType) -> HirType {
    HirType::PossiblyUndefined(Box::new(payload.clone()))
}
fn op(kind: OpKind, ty: HirType) -> Op {
    Op {
        kind,
        ty,
        origin: origin(),
    }
}
fn function(name: &str, parameters: &[HirType], result: HirType) -> Func {
    let values: Vec<_> = parameters
        .iter()
        .enumerate()
        .map(|(at, ty)| op(OpKind::Param(u32::try_from(at).unwrap()), ty.clone()))
        .collect();
    Func {
        name: name.into(),
        params: parameters
            .iter()
            .enumerate()
            .map(|(at, ty)| Param {
                name: format!("p{at}"),
                ty: ty.clone(),
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
                written: None,
            })
            .collect(),
        return_type: result,
        blocks: vec![Block {
            params: vec![],
            ops: (0..values.len())
                .map(|at| ValueId(u32::try_from(at).unwrap()))
                .collect(),
            terminator: Terminator::Return(None),
        }],
        values,
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: vec![],
        exact: rustc_hash::FxHashMap::default(),
        written_return: None,
        result_absent: Absent::Impossible,
        validation: None,
        written_return_elements: vec![],
    }
}
fn push(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(op(kind, ty));
    func.blocks[0].ops.push(id);
    id
}
fn field(name: &str, ty: HirType) -> Field {
    Field {
        name: name.into(),
        ty,
        written: None,
        declared_by: Some(TypeId(1)),
        readonly: false,
    }
}
fn fixture() -> Program {
    let payloads = [
        ("Bool", HirType::Bool),
        (
            "I32",
            HirType::Int {
                bits: 32,
                signed: true,
            },
        ),
        (
            "I64",
            HirType::Int {
                bits: 64,
                signed: true,
            },
        ),
        ("F32", HirType::Float { bits: 32 }),
        ("F64", HirType::NUMBER),
        ("Reference", HirType::Managed(ManagedType::String)),
    ];
    let mut fields: Vec<_> = payloads
        .iter()
        .map(|(name, ty)| field(name, optional(ty)))
        .collect();
    // Collides with the first candidate synthetic name. It is a real user
    // field and must not be renamed to or overwritten by the flag.
    fields.push(field("nts$defined$0", HirType::Bool));
    let base = Layout {
        types: vec![TypeId(1)],
        name: "OptionalBase".into(),
        fields,
        methods: vec![],
        interfaces: vec![TypeId(3)],
        base: None,
    };
    let derived = Layout {
        types: vec![TypeId(2)],
        name: "OptionalChild".into(),
        fields: base.fields.clone(),
        methods: vec![],
        interfaces: vec![TypeId(3)],
        base: Some(TypeId(1)),
    };
    let mut face = Layout {
        types: vec![TypeId(3)],
        name: "OptionalFace".into(),
        fields: base.fields.clone(),
        methods: vec![],
        interfaces: vec![],
        base: None,
    };
    for field in &mut face.fields {
        field.declared_by = None;
    }
    let mut program = Program {
        layouts: vec![base, derived, face],
        ..Program::default()
    };
    program.interface_identities.push(InterfaceIdentity {
        symbol: 3,
        name: "OptionalFace".into(),
        types: vec![TypeId(3)],
        names: std::collections::BTreeMap::default(),
        parents: [(TypeId(3), vec![])].into(),
    });
    let mut factory = function("makeHolder", &[], object(2));
    let made = push(&mut factory, OpKind::ObjectNew { frame: false }, object(2));
    let yes = push(&mut factory, OpKind::ConstBool(true), HirType::Bool);
    push(
        &mut factory,
        OpKind::FieldSet {
            object: made,
            field: 6,
            value: yes,
        },
        HirType::Void,
    );
    factory.blocks[0].terminator = Terminator::Return(Some(made));
    program.funcs.push(factory);
    append_methods(&mut program, payloads);
    program.public_api = program
        .funcs
        .iter()
        .map(|f| (f.name.clone(), f.name.clone()))
        .collect();
    program
}
fn append_methods(
    program: &mut Program,
    payloads: impl IntoIterator<Item = (&'static str, HirType)>,
) {
    for (index, (name, payload)) in payloads.into_iter().enumerate() {
        let at = u32::try_from(index).unwrap();
        let pair = optional(&payload);
        for (prefix, receiver) in [("", 2), ("Face", 3)] {
            let mut read = function(
                &format!("read{prefix}{name}"),
                &[object(receiver)],
                pair.clone(),
            );
            let value = push(
                &mut read,
                OpKind::FieldGet {
                    object: ValueId(0),
                    field: at,
                },
                pair.clone(),
            );
            read.blocks[0].terminator = Terminator::Return(Some(value));
            program.funcs.push(read);
            let mut write = function(
                &format!("write{prefix}{name}"),
                &[object(receiver), HirType::Bool, payload.clone()],
                HirType::Void,
            );
            let pair_value = push(
                &mut write,
                OpKind::Optional {
                    defined: ValueId(1),
                    payload: ValueId(2),
                },
                pair.clone(),
            );
            push(
                &mut write,
                OpKind::FieldSet {
                    object: ValueId(0),
                    field: at,
                    value: pair_value,
                },
                HirType::Void,
            );
            program.funcs.push(write);
        }
        let mut snapshot = function(
            &format!("snapshot{name}"),
            &[object(2), HirType::Bool, payload],
            pair.clone(),
        );
        let before = push(
            &mut snapshot,
            OpKind::FieldGet {
                object: ValueId(0),
                field: at,
            },
            pair.clone(),
        );
        let after = push(
            &mut snapshot,
            OpKind::Optional {
                defined: ValueId(1),
                payload: ValueId(2),
            },
            pair,
        );
        push(
            &mut snapshot,
            OpKind::FieldSet {
                object: ValueId(0),
                field: at,
                value: after,
            },
            HirType::Void,
        );
        snapshot.blocks[0].terminator = Terminator::Return(Some(before));
        program.funcs.push(snapshot);
    }
}
fn checked(command: &mut Command) {
    let out = command.output().expect("run JDK tool");
    assert!(
        out.status.success(),
        "{command:?}: {}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn optional_fields_preserve_components_owners_and_internal_names() {
    let program = fixture();
    assert_eq!(hir::verify::verify(&program), Ok(()));
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let dir = scratch::ScratchDir::new(
        Utf8Path::new(env!("CARGO_TARGET_TMPDIR")),
        "optional-fields",
    );
    let mut flags = 0;
    let mut collision_control = 0;
    for class in emitted.classes {
        let parsed = read::class_file(&class.bytes).expect("read emitted class");
        if class.binary_name == "nts/gen/OptionalChild" {
            assert!(
                parsed.fields.is_empty(),
                "inherited fields must not be redeclared"
            );
        }
        for field in &parsed.fields {
            assert_eq!(
                field.access & access::PUBLIC,
                0,
                "an internal field became public"
            );
            if field.name.starts_with("n$nts$defined$") {
                if field.access & access::SYNTHETIC == 0 {
                    collision_control += 1;
                } else {
                    flags += 1;
                }
            }
        }
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, class.bytes).unwrap();
    }
    assert!(flags >= 5, "primitive optional fields were not emitted");
    assert!(
        collision_control >= 1,
        "the physical-name collision control disappeared"
    );
    std::fs::write(dir.join("OptionalFieldsDriver.java"), DRIVER).unwrap();
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut javac = nts_codegen_jvm::toolchain::command("javac");
    javac.current_dir(dir.as_std_path()).args([
        "--release",
        "8",
        "-d",
        ".",
        "OptionalFieldsDriver.java",
    ]);
    for file in std::fs::read_dir(root.join("runtime/jvm/src/nts/rt")).unwrap() {
        let file = file.unwrap();
        if file.path().extension().is_some_and(|e| e == "java") {
            javac.arg(file.path());
        }
    }
    checked(&mut javac);
    checked(
        nts_codegen_jvm::toolchain::command("java")
            .current_dir(dir.as_std_path())
            .args(["-Xverify:all", "-cp", ".", "OptionalFieldsDriver"]),
    );
}

const DRIVER: &str = r#"
import nts.gen.Program;
import nts.gen.OptionalChild;
import nts.rt.NtsUndefinedReference;
public final class OptionalFieldsDriver {
  static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }
  public static void main(String[] ignored) throws Exception {
    OptionalChild holder = Program.makeHolder();
    long[] longs = { 7654321L };
    double[] doubles = { 12345.0 };
    check(Program.readBool(holder) == 0, "initial bool is undefined");
    check(Program.readI32(holder) == 0, "initial i32 is undefined");
    check(!Program.readI64(holder, longs) && longs[0] == 7654321L, "initial i64 does not write scratch");
    check(!Program.readF64(holder, doubles) && doubles[0] == 12345.0, "initial f64 does not write scratch");
    check(Program.readReference(holder) == NtsUndefinedReference.INSTANCE, "undefined is not Java null");
    Program.writeBool(holder, true, true);
    check(Program.readFaceBool(holder) == 3, "face reads both bool components");
    check(Program.snapshotBool(holder, false, false) == 3, "snapshot survives overwrite to undefined");
    check(Program.readBool(holder) == 0, "undefined overwrite clears bool flag");
    Program.writeFaceBool(holder, true, false);
    check(Program.readBool(holder) == 2, "defined false remains distinct from undefined");
    for (int value : new int[] { 0, -1, Integer.MIN_VALUE, Integer.MAX_VALUE }) {
      Program.writeFaceI32(holder, true, value);
      long got = Program.readI32(holder);
      check((got >>> 32) == 1 && (int)got == value, "i32 field bits");
    }
    for (long value : new long[] { 0, -1, Long.MIN_VALUE, Long.MAX_VALUE }) {
      Program.writeI64(holder, true, value);
      check(Program.readFaceI64(holder, longs) && longs[0] == value, "i64 face field bits");
      check(Program.snapshotI64(holder, false, 19L, longs) && longs[0] == value, "i64 snapshot");
      check(!Program.readI64(holder, longs), "i64 undefined overwrite");
    }
    for (int bits : new int[] { 0, 0x80000000, 0x7f800000, 0xff800000, 0x7fc00001, 0xffc01001 }) {
      Program.writeF32(holder, true, Float.intBitsToFloat(bits));
      long got = Program.readFaceF32(holder);
      check((got >>> 32) == 1 && (int)got == bits, "f32 raw bits");
    }
    for (long bits : new long[] { 0, 0x8000000000000000L, 0x7ff0000000000000L,
        0xfff0000000000000L, 0x7ff8000000000001L, 0xfff8123456789abcL }) {
      Program.writeFaceF64(holder, true, Double.longBitsToDouble(bits));
      check(Program.readF64(holder, doubles) && Double.doubleToRawLongBits(doubles[0]) == bits, "f64 raw bits");
      check(Program.snapshotF64(holder, false, 11.0, doubles) && Double.doubleToRawLongBits(doubles[0]) == bits, "f64 snapshot");
      check(!Program.readFaceF64(holder, doubles), "face sees f64 undefined overwrite");
    }
    Program.writeReference(holder, true, null);
    check(Program.readFaceReference(holder) == null, "defined null is not undefined");
    check(Program.snapshotReference(holder, false, "discarded") == null, "reference snapshot");
    check(Program.readReference(holder) == NtsUndefinedReference.INSTANCE, "reference overwritten to undefined");
    java.lang.reflect.Field user = holder.getClass().getSuperclass().getDeclaredField("n$nts$defined$0");
    user.setAccessible(true);
    check(user.getBoolean(holder), "synthetic flag never overwrites the colliding user field");
  }
}
"#;
