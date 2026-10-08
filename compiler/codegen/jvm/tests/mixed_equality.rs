//! `===` between a string and another reference: reference identity, never string equality.
//!
//! `value === Error` specialised for a string `value` is an `eq` between a string and a class
//! constructor -- legal, and always false. Both of this backend's string arms asked only the *left*
//! operand, so the value form called `stringEq(String, String)` and the branch form
//! `String.compareTo(String)` with the other reference on the stack: `VerifyError` (the compiler lane's
//! integration `class-values`, `isProvided@0estr`, 2026-10-04). C and LLVM compare addresses and answer
//! false by luck. Hand HIR with a symbol as the other reference, so this does not depend on which
//! specialisation lowering happens to make; the control pins that two *equal strings that are different
//! objects* still compare by value.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use nts_core::hir::{self, BinOp, BlockId, HirType, ManagedType, OpKind, ValueId};

mod common;

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn op(kind: OpKind, ty: HirType) -> hir::Op {
    hir::Op { kind, ty, origin: origin() }
}

fn param(i: usize, ty: &HirType) -> hir::Param {
    hir::Param {
        name: format!("p{i}"),
        ty: ty.clone(),
        origin: origin(),
        shape: hir::ParamShape::Ordinary,
        known: hir::facts::Facts::TOP,
        written: None,
    }
}

fn block(ops: &[u32], terminator: hir::Terminator) -> hir::Block {
    hir::Block { params: Vec::new(), ops: ops.iter().map(|&v| ValueId(v)).collect(), terminator }
}

fn func(name: &str, params: &[HirType], returns: HirType, values: Vec<hir::Op>, blocks: Vec<hir::Block>) -> hir::Func {
    hir::Func {
        name: name.into(),
        params: params.iter().enumerate().map(|(i, ty)| param(i, ty)).collect(),
        return_type: returns,
        values,
        blocks,
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

/// `(a, b) -> a op b`, the comparison's value returned.
fn valued(name: &str, a: &HirType, b: &HirType, compare: BinOp) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), a.clone()),
        op(OpKind::Param(1), b.clone()),
        op(OpKind::Binary { op: compare, lhs: ValueId(0), rhs: ValueId(1) }, HirType::Bool),
    ];
    func(name, &[a.clone(), b.clone()], HirType::Bool, values, vec![block(&[0, 1, 2], hir::Terminator::Return(Some(ValueId(2))))])
}

/// `(a, b) -> a === b ? 1 : 0`, the comparison consumed by a branch.
fn branched(name: &str, a: &HirType, b: &HirType) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), a.clone()),
        op(OpKind::Param(1), b.clone()),
        op(OpKind::Binary { op: BinOp::Eq, lhs: ValueId(0), rhs: ValueId(1) }, HirType::Bool),
        op(OpKind::ConstFloat(1.0), HirType::NUMBER),
        op(OpKind::ConstFloat(0.0), HirType::NUMBER),
    ];
    let blocks = vec![
        block(
            &[0, 1, 2],
            hir::Terminator::Branch {
                cond: ValueId(2),
                then_target: BlockId(1),
                then_args: Vec::new(),
                else_target: BlockId(2),
                else_args: Vec::new(),
            },
        ),
        block(&[3], hir::Terminator::Return(Some(ValueId(3)))),
        block(&[4], hir::Terminator::Return(Some(ValueId(4)))),
    ];
    func(name, &[a.clone(), b.clone()], HirType::NUMBER, values, blocks)
}

#[test]
fn a_string_against_another_reference_is_identity_in_both_forms() {
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP mixed_equality: no JDK");
        return;
    };
    let string = HirType::Managed(ManagedType::String);
    let symbol = HirType::Managed(ManagedType::Symbol);
    let program = hir::Program {
        funcs: vec![
            valued("eqOther", &string, &symbol, BinOp::Eq),
            valued("neOther", &string, &symbol, BinOp::Ne),
            branched("branchOther", &string, &symbol),
            // Controls: two strings still compare by value, in both forms.
            valued("eqStrings", &string, &string, BinOp::Eq),
            branched("branchStrings", &string, &string),
        ],
        ..hir::Program::default()
    };
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics.iter().map(|d| d.message.clone()).collect::<Vec<_>>());
    let out = std::env::temp_dir().join(format!("nts-mixed-equality-{}", std::process::id()));
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
  NtsSymbol sym = NtsSymbol.newSymbol("x");
  String built = new StringBuilder("a").append("b").toString();
  System.out.println(nts.gen.Program.eqOther("x", sym) + " " + nts.gen.Program.neOther("x", sym) + " " + nts.gen.Program.branchOther("x", sym));
  System.out.println(nts.gen.Program.eqStrings(built, "ab") + " " + nts.gen.Program.branchStrings(built, "ab") + " " + nts.gen.Program.eqStrings(built, "ac"));
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
    assert_eq!(said, "false true 0.0\ntrue 1.0 false\n");
}
