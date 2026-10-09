//! An unsigned integer is one on the JVM, which has no unsigned types.
//!
//! A `u32` is held raw in an `int` and a `u64` in a `long`, so the top bit is a
//! value bit, and every signed instruction reads it as a sign:
//! - `if_icmp` / `lcmp` answered `3000000000 > 1` false;
//! - `l2d` and `l2f` turned 2^64 - 1 into -1;
//! - an `Erase` of a `u32` widened it with `i2d`.
//!
//! The C and LLVM backends emit `icmp ugt` and `uitofp` and were never wrong.
//! Plain TypeScript does not hold a `u32` in a register until written kinds are
//! stored at their width (scalar step 2f), so this is hand HIR: every
//! operation the JVM backend gives an unsigned operand, at values just past
//! 2^31 and 2^63, in both the value and the branch forms of a comparison.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use nts_core::hir::{self, BinOp, BlockId, HirType, OpKind, ValueId};

mod common;

const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
const U64: HirType = HirType::Int {
    bits: 64,
    signed: false,
};

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn op(kind: OpKind, ty: HirType) -> hir::Op {
    hir::Op {
        kind,
        ty,
        origin: origin(),
    }
}

fn block(ops: &[u32], terminator: hir::Terminator) -> hir::Block {
    hir::Block {
        params: Vec::new(),
        ops: ops.iter().map(|&v| ValueId(v)).collect(),
        terminator,
    }
}

fn func(
    name: &str,
    params: &[HirType],
    returns: HirType,
    values: Vec<hir::Op>,
    blocks: Vec<hir::Block>,
) -> hir::Func {
    hir::Func {
        name: name.into(),
        params: params
            .iter()
            .enumerate()
            .map(|(i, ty)| hir::Param {
                name: format!("p{i}"),
                ty: ty.clone(),
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
                written: None,
            })
            .collect(),
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
        written_return_elements: Vec::new(),
    }
}

/// `(a, b) -> a op b` over `ty`, the comparison's value returned.
fn valued(name: &str, ty: &HirType, compare: BinOp) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), ty.clone()),
        op(OpKind::Param(1), ty.clone()),
        op(
            OpKind::Binary {
                op: compare,
                lhs: ValueId(0),
                rhs: ValueId(1),
            },
            HirType::Bool,
        ),
    ];
    func(
        name,
        &[ty.clone(), ty.clone()],
        HirType::Bool,
        values,
        vec![block(&[0, 1, 2], hir::Terminator::Return(Some(ValueId(2))))],
    )
}

/// `(a, b) -> a > b ? 1 : 0` over `ty`, the comparison consumed by a branch.
fn branched(name: &str, ty: &HirType) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), ty.clone()),
        op(OpKind::Param(1), ty.clone()),
        op(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: ValueId(0),
                rhs: ValueId(1),
            },
            HirType::Bool,
        ),
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
    func(
        name,
        &[ty.clone(), ty.clone()],
        HirType::NUMBER,
        values,
        blocks,
    )
}

/// `a -> a` converted to `to`.
fn converted(name: &str, from: &HirType, to: &HirType) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), from.clone()),
        op(OpKind::Convert(ValueId(0)), to.clone()),
    ];
    func(
        name,
        std::slice::from_ref(from),
        to.clone(),
        values,
        vec![block(&[0, 1], hir::Terminator::Return(Some(ValueId(1))))],
    )
}

/// `a -> a` erased and read back as a number.
fn erased(name: &str, from: &HirType) -> hir::Func {
    let values = vec![
        op(OpKind::Param(0), from.clone()),
        op(
            OpKind::Erase {
                value: ValueId(0),
                absent: hir::Absent::Impossible,
            },
            HirType::Erased,
        ),
        op(OpKind::Unerase { value: ValueId(1) }, HirType::NUMBER),
    ];
    func(
        name,
        std::slice::from_ref(from),
        HirType::NUMBER,
        values,
        vec![block(&[0, 1, 2], hir::Terminator::Return(Some(ValueId(2))))],
    )
}

#[test]
fn an_unsigned_integer_compares_and_converts_as_one() {
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP unsigned: no JDK");
        return;
    };
    let program = hir::Program {
        funcs: vec![
            valued("gt32", &U32, BinOp::Gt),
            valued("le32", &U32, BinOp::Le),
            valued("lt64", &U64, BinOp::Lt),
            valued("ge64", &U64, BinOp::Ge),
            // Equality needs nothing, and stays as it was.
            valued("eq32", &U32, BinOp::Eq),
            branched("above32", &U32),
            branched("above64", &U64),
            converted("double64", &U64, &HirType::NUMBER),
            converted("float64", &U64, &HirType::Float { bits: 32 }),
            converted("double32", &U32, &HirType::NUMBER),
            erased("erased32", &U32),
        ],
        ..hir::Program::default()
    };
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.is_complete(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| d.message.clone())
            .collect::<Vec<_>>()
    );
    let out = std::env::temp_dir().join(format!("nts-unsigned-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    // 3000000000 as a raw `int`, and 2^63 and 2^64 - 1 as raw `long`s.
    std::fs::write(
        out.join("Drive.java"),
        r#"public class Drive { public static void main(String[] a) {
  int big = (int) 3000000000L;
  long top = Long.MIN_VALUE;
  long max = -1L;
  System.out.println(nts.gen.Program.gt32(big, 1) + " " + nts.gen.Program.le32(big, 1) + " " + nts.gen.Program.eq32(big, big));
  System.out.println(nts.gen.Program.lt64(top, 1L) + " " + nts.gen.Program.ge64(top, 1L));
  System.out.println(nts.gen.Program.above32(big, 1) + " " + nts.gen.Program.above64(top, 1L));
  System.out.println(nts.gen.Program.double64(max) + " " + nts.gen.Program.float64(max) + " " + nts.gen.Program.double32(big));
  System.out.println(nts.gen.Program.erased32(big));
}}
"#,
    )
    .unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac)
        .args(["-cp", &cp, "-d"])
        .arg(&out)
        .arg(out.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(&java)
        .args(["-Xverify:all", "-cp", &cp, "Drive"])
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).into_owned();
    assert!(
        ran.status.success(),
        "{said}{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    // node: 3000000000 > 1, 2^63 >= 1, 2^64 - 1 as a number, as a float.
    assert_eq!(
        said,
        "true false true\nfalse true\n1.0 1.0\n1.8446744073709552E19 1.8446744E19 3.0E9\n3.0E9\n"
    );
}
