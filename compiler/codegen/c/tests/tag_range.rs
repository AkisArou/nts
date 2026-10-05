//! Execute the folded `typeof x === "object"` band over every tag, including
//! `NTS_TAG_BIGINT` above it, which must answer "bigint" and not "object".
#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, BinOp, Callee, HirType, ManagedType, Op, OpKind, ValueId};
use nts_semantic_schema::Origin;

fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn predicate(name: &str, negate: bool) -> hir::Func {
    let input = HirType::Erased;
    let tag = HirType::Int {
        bits: 32,
        signed: false,
    };
    let text = HirType::Managed(ManagedType::String);
    let values = vec![
        (OpKind::Param(0), input.clone()),
        (OpKind::TagOf { value: ValueId(0) }, tag),
        (OpKind::Convert(ValueId(1)), HirType::NUMBER),
        (
            OpKind::Call {
                callee: Callee::External("nts_tag_name".into()),
                args: vec![ValueId(2)],
                frame: None,
            },
            text.clone(),
        ),
        (OpKind::ConstString("object".into()), text),
        (
            OpKind::Binary {
                op: if negate { BinOp::Ne } else { BinOp::Eq },
                lhs: ValueId(3),
                rhs: ValueId(4),
            },
            HirType::Bool,
        ),
    ]
    .into_iter()
    .map(|(kind, ty)| Op {
        kind,
        ty,
        origin: origin(),
    })
    .collect();
    let mut func = hir::Func {
        name: name.to_owned(),
        params: vec![hir::Param {
            name: "input".into(),
            ty: input,
            origin: origin(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
        }],
        return_type: HirType::Bool,
        values,
        blocks: vec![hir::Block {
            params: Vec::new(),
            ops: (0..6).map(ValueId).collect(),
            terminator: hir::Terminator::Return(Some(ValueId(5))),
        }],
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
    };
    assert_eq!(hir::tags::fold_comparisons(&mut func), 1);
    hir::dce::eliminate(&mut func);
    func
}

#[test]
fn folded_object_tests_answer_for_exactly_the_object_band() {
    if std::process::Command::new("clang")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("SKIP tag range: clang is required");
        return;
    }
    let program = hir::Program {
        funcs: vec![predicate("isObject", false), predicate("isNotObject", true)],
        ..hir::Program::default()
    };
    assert!(hir::verify::verify(&program).is_ok());
    let emitted = nts_codegen_c::emit(&program, hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    // Allocation-free after the fold; the runtime's definition is a separate
    // translation unit and does not count as a surviving generated call.
    assert!(!emitted.writer.text().contains("nts_tag_name"));
    let dir = std::env::temp_dir().join(format!("nts-tag-range-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let mut runtime = Vec::new();
    for file in emitted.support_files() {
        let written = file.write(&dir).unwrap();
        if file.compiled {
            runtime.push(written);
        }
    }
    std::fs::write(
        dir.join("main.c"),
        r#"
#include "program.h"
#include <stdio.h>
bool isObject(NtsValue input);
bool isNotObject(NtsValue input);
int main(void) {
  for (uint32_t tag = 0; tag <= NTS_TAG_BIGINT; tag++) {
    NtsValue v = { .tag = tag, .as.number = 0 };
    bool expected = tag == NTS_TAG_OBJECT || tag == NTS_TAG_NULL || NTS_TAG_IS_HANDLE(tag);
    if (isObject(v) != expected || isNotObject(v) == expected) {
      fprintf(stderr, "tag %u has the wrong typeof-object answer\n", tag);
      return 1;
    }
  }
  puts("34 tag comparisons passed");
  return 0;
}
"#,
    )
    .unwrap();
    let binary = dir.join("run");
    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2"])
        .arg("-I")
        .arg(&dir)
        .arg(dir.join("program.c"))
        .arg(dir.join("main.c"))
        .args(runtime)
        .args(["-lm", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let ran = std::process::Command::new(&binary).output().unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(String::from_utf8_lossy(&ran.stdout).contains("34 tag comparisons passed"));
    std::fs::remove_dir_all(dir).unwrap();
}
