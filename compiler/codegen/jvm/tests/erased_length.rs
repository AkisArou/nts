//! `Length` of an erased array, which lowering emits after its checked array-shape guard.
//!
//! C and LLVM read the actual header; the JVM's `length_of` refused an erased operand outright, so a
//! nested array's length (the compiler lane's nested-array views, 2026-10-04) had no JVM spelling. It
//! is answered by the actual representation at run time -- never a `checkcast` to the wrapper the
//! static type might suggest -- which the driver checks by handing the *same* generated method every
//! representation: a cast to any one of them would throw for the others.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use nts_core::hir::{self, HirType, OpKind, ValueId};

mod common;

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

/// `name(a: erased) -> returns`, the length of `a`.
fn length(name: &str, returns: HirType) -> hir::Func {
    let op = |kind, ty| hir::Op { kind, ty, origin: origin() };
    hir::Func {
        name: name.into(),
        params: vec![hir::Param {
            name: "a".into(),
            ty: HirType::Erased,
            origin: origin(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        }],
        return_type: returns.clone(),
        values: vec![op(OpKind::Param(0), HirType::Erased), op(OpKind::Length(ValueId(0)), returns)],
        blocks: vec![hir::Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1)],
            terminator: hir::Terminator::Return(Some(ValueId(1))),
        }],
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        written_return: None,
    }
}

#[test]
fn an_erased_length_reads_every_actual_representation() {
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP erased_length: no JDK");
        return;
    };
    let program = hir::Program {
        funcs: vec![length("asNumber", HirType::NUMBER), length("asInt", HirType::Int { bits: 32, signed: true })],
        ..hir::Program::default()
    };
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics.iter().map(|d| d.message.clone()).collect::<Vec<_>>());
    let out = std::env::temp_dir().join(format!("nts-erased-length-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    std::fs::write(
        out.join("Drive.java"),
        r#"import nts.rt.*;
public class Drive { public static void main(String[] a) {
  NtsArrayD grown = NtsArrayD.of(0);
  for (int i = 0; i < 5; i++) NtsArrayD.push(grown, i);
  Object[] held = { grown, NtsArrayL.of(2), NtsArrayZ.of(3), NtsTemplate.of(new String[] { null }),
    new double[4], new int[6], new long[7], new boolean[8], new NtsValue[9], new String[0] };
  StringBuilder line = new StringBuilder();
  for (Object h : held) {
    NtsValue v = NtsValue.ofObject(h);
    line.append((long) nts.gen.Program.asNumber(v)).append(':').append(nts.gen.Program.asInt(v)).append(' ');
  }
  try { nts.gen.Program.asNumber(NtsValue.ofObject(new NtsTuple() { })); line.append("tuple answered"); }
  catch (NtsRefusal e) { line.append("tuple refused"); }
  System.out.println(line.toString().trim());
}}
"#,
    )
    .unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac).args(["-cp", &cp, "-d"]).arg(&out).arg(out.join("Drive.java")).output().unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
    let ran = Command::new(&java).args(["-Xverify:all", "-cp", &cp, "Drive"]).output().unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).into_owned();
    assert!(ran.status.success(), "{said}{}", String::from_utf8_lossy(&ran.stderr));
    assert_eq!(said.trim(), "5:5 2:2 3:3 1:1 4:4 6:6 7:7 8:8 9:9 0:0 tuple refused");
}
