//! A native caller supplies the object hidden inside an erased array element.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, HirType, ManagedType, OpKind, ValueId};
use nts_semantic_schema::{Origin, TypeId};

fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn program() -> hir::Program {
    let array = HirType::Managed(ManagedType::Array(Box::new(HirType::Erased)));
    let object = HirType::Managed(ManagedType::Object(TypeId(1)));
    let values = vec![
        (OpKind::Param(0), array.clone()),
        (OpKind::ConstFloat(0.0), HirType::NUMBER),
        (
            OpKind::ArrayGet {
                array: ValueId(0),
                index: ValueId(1),
                checked: false,
            },
            HirType::Erased,
        ),
        (OpKind::Unerase { value: ValueId(2) }, object),
        (
            OpKind::FieldGet {
                object: ValueId(3),
                field: 0,
            },
            HirType::NUMBER,
        ),
    ]
    .into_iter()
    .map(|(kind, ty)| hir::Op {
        kind,
        ty,
        origin: origin(),
    })
    .collect();
    hir::Program {
        funcs: vec![hir::Func {
            name: "readExternal".into(),
            params: vec![hir::Param {
                name: "items".into(),
                ty: array,
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
            }],
            return_type: HirType::NUMBER,
            values,
            blocks: vec![hir::Block {
                params: Vec::new(),
                ops: (0..5).map(ValueId).collect(),
                terminator: hir::Terminator::Return(Some(ValueId(4))),
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
        }],
        layouts: vec![hir::Layout {
            types: vec![TypeId(1)],
            name: "Payload".into(),
            fields: vec![hir::Field {
                name: "x".into(),
                ty: HirType::NUMBER,
                readonly: false,
                declared_by: None,
            }],
            methods: Vec::new(),
            interfaces: Vec::new(),
            base: None,
        }],
        ..hir::Program::default()
    }
}

#[test]
fn a_recovered_external_field_survives_folding_and_reads_the_callers_value() {
    if std::process::Command::new("clang")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("SKIP external field execution: clang is required");
        return;
    }
    let mut program = program();
    let analyses =
        hir::interprocedural::analyze_program(&program, hir::reachable::Roots::EveryExport);
    for (func, analysis) in program.funcs.iter_mut().zip(&analyses) {
        hir::fold::fold(func, analysis);
        hir::dce::eliminate(func);
    }
    assert!(hir::verify::verify(&program).is_ok());
    let emitted = nts_codegen_c::emit(&program, hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let dir = std::env::temp_dir().join(format!("nts-external-fields-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let mut runtime = Vec::new();
    for file in emitted.support_files() {
        let path = file.write(&dir).unwrap();
        if file.compiled {
            runtime.push(path);
        }
    }
    // Include the generated layout so this is an actual external storage
    // producer, with no HIR store for the optimiser to join into field facts.
    std::fs::write(dir.join("main.c"), r#"#include "program.c"
#include <math.h>
#include <stdio.h>
int main(void) {
  const double inputs[] = { 0.125, -0.0, NAN, INFINITY, -INFINITY, 9007199254740992.0, -17.75 };
  const NtsDescriptor array_desc = { .kind = NTS_KIND_ARRAY, .size = sizeof(NtsValue), .erased = 1 };
  const NtsDescriptor payload_desc = { .kind = NTS_KIND_OBJECT, .size = sizeof(NtsObj_Payload) };
  NtsObj_Payload payload = {0};
  payload.header.descriptor = &payload_desc;
  payload.header.reserved = NTS_IMMORTAL;
  NtsValue value = nts_value_of_reference(&payload.header, NTS_TAG_OBJECT);
  NtsArray array = { .header = { .descriptor = &array_desc, .reserved = NTS_IMMORTAL, .length = 1 }, .capacity = 1, .elements = &value };
  for (unsigned i = 0; i < sizeof(inputs) / sizeof(inputs[0]); i++) {
    payload.x = inputs[i];
    double actual = readExternal(&array);
    if ((isnan(inputs[i]) && !isnan(actual)) ||
        (!isnan(inputs[i]) && (actual != inputs[i] || signbit(actual) != signbit(inputs[i])))) {
      fprintf(stderr, "external field %u changed: %.17g -> %.17g\n", i, inputs[i], actual);
      return 1;
    }
  }
  puts("7 external field values passed");
  return 0;
}
"#).unwrap();
    let binary = dir.join("run");
    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2"])
        .arg("-I")
        .arg(&dir)
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
    assert!(String::from_utf8_lossy(&ran.stdout).contains("7 external field values passed"));
    std::fs::remove_dir_all(dir).unwrap();
}
