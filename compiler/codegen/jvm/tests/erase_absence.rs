//! A null reference erased with an `undefined` absence is `undefined`, whatever its tag.
//!
//! `ofString` and `ofTagged` answer `NULL_VALUE` for a null reference, which is right only when the
//! absence is `null`. `string | undefined` erased answered `null` for its `undefined` -- the compiler
//! lane's `a-recovered-erased-value-keeps-its-absence` (2026-10-04), once lowering stopped folding the
//! value as a non-nullable string -- while C and LLVM read the absence and agreed. Hand HIR, a string
//! and a symbol, each erased with each absence; the `null` arms are the controls.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use nts_core::hir::{self, Absent, HirType, ManagedType, OpKind, ValueId};

mod common;

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

/// `name(v: ty) -> erased`, erasing `v` with `absent`.
fn eraser(name: &str, ty: &HirType, absent: Absent) -> hir::Func {
    let op = |kind, ty| hir::Op { kind, ty, origin: origin() };
    hir::Func {
        name: name.into(),
        params: vec![hir::Param {
            name: "v".into(),
            ty: ty.clone(),
            origin: origin(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        }],
        return_type: HirType::Erased,
        values: vec![op(OpKind::Param(0), ty.clone()), op(OpKind::Erase { value: ValueId(0), absent }, HirType::Erased)],
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
fn a_null_reference_erases_to_the_absence_the_ir_names() {
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP erase_absence: no JDK");
        return;
    };
    let string = HirType::Managed(ManagedType::String);
    let symbol = HirType::Managed(ManagedType::Symbol);
    let program = hir::Program {
        funcs: vec![
            eraser("stringOrUndefined", &string, Absent::Undefined),
            eraser("stringOrNull", &string, Absent::Null),
            eraser("symbolOrUndefined", &symbol, Absent::Undefined),
            eraser("symbolOrNull", &symbol, Absent::Null),
        ],
        ..hir::Program::default()
    };
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics.iter().map(|d| d.message.clone()).collect::<Vec<_>>());
    let out = std::env::temp_dir().join(format!("nts-erase-absence-{}", std::process::id()));
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
public class Drive {
  static String t(NtsValue v) { return NtsValue.tagName(v.tag); }
  public static void main(String[] a) {
    NtsSymbol s = NtsSymbol.newSymbol("x");
    System.out.println(t(nts.gen.Program.stringOrUndefined(null)) + " " + t(nts.gen.Program.stringOrUndefined("a"))
      + " " + t(nts.gen.Program.stringOrNull(null)) + " " + t(nts.gen.Program.stringOrNull("a")));
    System.out.println(t(nts.gen.Program.symbolOrUndefined(null)) + " " + t(nts.gen.Program.symbolOrUndefined(s))
      + " " + t(nts.gen.Program.symbolOrNull(null)) + " " + t(nts.gen.Program.symbolOrNull(s)));
  }
}
"#,
    )
    .unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac).args(["-cp", &cp, "-d"]).arg(&out).arg(out.join("Drive.java")).output().unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
    let ran = Command::new(&java).args(["-Xverify:all", "-cp", &cp, "Drive"]).output().unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).into_owned();
    assert!(ran.status.success(), "{said}{}", String::from_utf8_lossy(&ran.stderr));
    // `typeof null` is "object", which is how `tagName` spells the null tag.
    assert_eq!(said, "undefined string object string\nundefined symbol object symbol\n");
}
