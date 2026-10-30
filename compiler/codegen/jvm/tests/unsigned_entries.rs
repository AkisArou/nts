//! Java callers pass unsigned values; direct compiled calls retain raw words.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::facts::Facts;
use nts_core::hir::{self, HirType, OpKind, ValueId};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;

mod common;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

fn function(name: &str, signed: bool, forward: bool) -> hir::Func {
    let ty = HirType::Int { bits: 32, signed };
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    });
    let mut values = vec![hir::Op {
        kind: OpKind::Param(0),
        ty: ty.clone(),
        origin: origin.clone(),
    }];
    if forward {
        values.push(hir::Op {
            kind: OpKind::Call {
                callee: hir::Callee::Direct("unsigned".to_owned()),
                args: vec![ValueId(0)],
                frame: None,
            },
            ty: ty.clone(),
            origin: origin.clone(),
        });
    }
    let result = if forward { ValueId(1) } else { ValueId(0) };
    hir::Func {
        name: name.to_owned(),
        params: vec![hir::Param {
            name: "value".to_owned(),
            ty: ty.clone(),
            origin: origin.clone(),
            shape: hir::ParamShape::Ordinary,
            known: Facts::TOP,
            written: None,
        }],
        return_type: ty,
        values,
        blocks: vec![hir::Block {
            params: Vec::new(),
            ops: if forward {
                vec![ValueId(0), ValueId(1)]
            } else {
                vec![ValueId(0)]
            },
            terminator: hir::Terminator::Return(Some(result)),
        }],
        origin,
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: hir::ExactArithmetic::default(),
        written_return: None,
        result_absent: hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    }
}

#[test]
fn unsigned_entries_use_long_and_internal_forwarding_uses_int() {
    for (authored, implementation) in [
        ("unsigned$nts$uint32", "unsigned$nts$uint32$1"),
        ("unsigned$nts$control", "unsigned$nts$uint32"),
    ] {
        let program = hir::Program {
            funcs: vec![
                function("unsigned", false, false),
                function("signed", true, false),
                function("forward", false, true),
                function(authored, true, false),
            ],
            ..hir::Program::default()
        };
        hir::verify::verify(&program).unwrap();
        let emitted = nts_codegen_jvm::emit(&program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let class = emitted
            .classes
            .iter()
            .map(|class| nts_jvm_emitter::read::class_file(&class.bytes).unwrap())
            .find(|class| class.binary_name == "nts/gen/Program")
            .unwrap();
        for (name, descriptor) in [
            ("unsigned", "(J)J"),
            (implementation, "(I)I"),
            (authored, "(I)I"),
            ("forward", "(J)J"),
            ("forward$nts$uint32", "(I)I"),
            ("signed", "(I)I"),
        ] {
            assert!(
                class
                    .methods
                    .iter()
                    .any(|method| method.name == name && method.descriptor == descriptor),
                "missing {name}{descriptor}"
            );
        }
        run_java(&emitted, &r#"
import nts.gen.Program;
public class Drive {
  public static void main(String[] args) {
    for (long n : new long[] {0, 1, 0x7fffffffL, 0x80000000L, 0xffffffffL}) {
      if (Program.unsigned(n) != n || Program.forward(n) != n) throw new AssertionError("unsigned " + n);
    }
    for (int n : new int[] {0, 1, -1, Integer.MIN_VALUE, Integer.MAX_VALUE}) {
      if (Program.signed(n) != n || Program.AUTHORED(n) != n) throw new AssertionError("signed " + n);
    }
  }
}
"#.replace("AUTHORED", authored));
    }
}

fn many_parameters(name: &str, count: usize, declined: bool) -> hir::Func {
    let mut func = function(name, false, false);
    func.params = (0..count)
        .map(|index| hir::Param {
            name: format!("p{index}"),
            ..func.params[0].clone()
        })
        .collect();
    func.values = (0..count)
        .map(|index| hir::Op {
            kind: OpKind::Param(u32::try_from(index).unwrap()),
            ty: func.return_type.clone(),
            origin: func.origin.clone(),
        })
        .collect();
    if declined {
        func.values.push(hir::Op {
            kind: OpKind::NativeLocal { count: 1 },
            ty: HirType::NativePointer(hir::native::Pointee::Scalar(hir::native::Scalar::Int)),
            origin: func.origin.clone(),
        });
    }
    func.blocks[0].ops = (0..func.values.len())
        .map(|index| ValueId(u32::try_from(index).unwrap()))
        .collect();
    func
}

fn direct_caller(callee: &hir::Func) -> hir::Func {
    let mut func = function(&format!("call_{}", callee.name), false, false);
    func.params.clear();
    func.values[0].kind = OpKind::ConstInt(0x8000_0000);
    func.values.push(hir::Op {
        kind: OpKind::Call {
            callee: hir::Callee::Direct(callee.name.clone()),
            args: vec![ValueId(0); callee.params.len()],
            frame: None,
        },
        ty: func.return_type.clone(),
        origin: func.origin.clone(),
    });
    func.blocks[0].ops.push(ValueId(1));
    func.blocks[0].terminator = hir::Terminator::Return(Some(ValueId(1)));
    func
}

#[test]
fn public_slot_limit_preserves_internal_bodies_and_refusal_stubs() {
    let mut funcs = Vec::new();
    for (name, count, declined) in [
        ("many127", 127, false),
        ("many128", 128, false),
        ("declined128", 128, true),
    ] {
        let func = many_parameters(name, count, declined);
        funcs.push(direct_caller(&func));
        funcs.push(func);
    }
    let program = hir::Program {
        funcs,
        ..hir::Program::default()
    };
    hir::verify::verify(&program).unwrap();
    let emitted = nts_codegen_jvm::emit(&program);
    let diagnostics = format!("{:?}", emitted.diagnostics);
    assert!(
        diagnostics.contains("255 parameter-slot limit"),
        "{diagnostics}"
    );
    assert!(diagnostics.contains("declined128"), "{diagnostics}");
    let class = emitted
        .classes
        .iter()
        .map(|class| nts_jvm_emitter::read::class_file(&class.bytes).unwrap())
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    for (name, count) in [("many127", 127), ("many128", 128), ("declined128", 128)] {
        assert!(
            class.methods.iter().any(|method| {
                method.name == format!("{name}$nts$uint32")
                    && method.descriptor == format!("({})I", "I".repeat(count))
            }),
            "missing internal {name}"
        );
        assert_eq!(
            class.methods.iter().any(|method| method.name == name),
            count == 127,
            "public slot limit for {name}"
        );
    }
    let arguments = vec!["0x80000000L"; 127].join(",");
    run_java(
        &emitted,
        &format!(
            r#"
import nts.gen.Program;
public class Drive {{
  public static void main(String[] args) {{
    if (Program.many127({arguments}) != 0x80000000L) throw new AssertionError("public boundary");
    if (Program.call_many127() != 0x80000000L) throw new AssertionError("internal 127");
    if (Program.call_many128() != 0x80000000L) throw new AssertionError("internal 128");
    try {{
      Program.call_declined128();
      throw new AssertionError("missing refusal");
    }} catch (nts.rt.NtsRefusal refused) {{
      if (!refused.getMessage().contains("`declined128` was declined:")) throw new AssertionError(refused);
    }}
  }}
}}
"#
        ),
    );
}

fn run_java(emitted: &nts_codegen_jvm::Emitted, source: &str) {
    let root =
        Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../target/jvm-unsigned-entry-tests");
    let dir = scratch::ScratchDir::new(&root, "unsigned-entries");
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    std::fs::write(dir.join("Drive.java"), source).unwrap();
    let cp = std::env::join_paths([dir.as_std_path(), jar.as_std_path()]).unwrap();
    let compiled = nts_codegen_jvm::toolchain::command(common::tool("javac").expect("JDK"))
        .args(["--release", "8", "-cp"])
        .arg(&cp)
        .arg(dir.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = nts_codegen_jvm::toolchain::command(common::tool("java").expect("JDK"))
        .args(["-Xverify:all", "-cp"])
        .arg(&cp)
        .arg("Drive")
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}
