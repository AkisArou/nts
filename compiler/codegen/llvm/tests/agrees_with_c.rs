//! One HIR, two backends, the same answers.
//!
//! This is the reason the C backend does not go away when the LLVM one grows
//! up. A disagreement between them is a *backend* bug by construction: the
//! program, the lowering, every optimisation and the runtime are identical, and
//! only the rendering differs. Nothing else in this repository can isolate a
//! backend that way — the differential compares against node, which is the
//! right oracle for semantics and says nothing about which renderer was wrong.
//!
//! scriptc gave this up. Their C backend cannot express coroutines, so it is
//! debug-only and their LLVM output has no second opinion. Ours can, because
//! suspension is a *middle end* transform: `hir::suspend` turns a suspending
//! function into a state machine before any backend sees it.
//!
//! The pool is deliberately hostile in the same way the differential's is: both
//! zeroes, both infinities, a NaN, past 2^53, and the 1e21 notation boundary.
//! An arithmetic backend that is right about ordinary numbers and wrong about
//! these is right about nothing.

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// The values every function is driven with.
const POOL: &str = "{0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 1.0/0.0, -1.0/0.0, 0.0/0.0, \
                    9007199254740993.0, 2147483648.0}";

fn tsgo() -> Option<String> {
    let path = std::env::var("NTS_TSGO").ok()?;
    std::path::Path::new(&path).exists().then_some(path)
}

/// Lower a fixture, render it both ways, build both, run both, compare.
fn both_backends(source: &str, driver: &str) -> Option<(String, String)> {
    let tsgo = tsgo()?;
    let dir = std::env::temp_dir().join(format!("nts-llvm-{}", std::process::id()));
    let src = dir.join("src");
    std::fs::create_dir_all(&src).expect("a work directory");
    std::fs::write(src.join("main.ts"), source).expect("write the program");
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ES2022", "module": "ESNext",
             "moduleResolution": "bundler", "strict": true,
             "noUncheckedIndexedAccess": true, "noEmit": true },
             "include": ["src"] }"#,
    )
    .expect("write the tsconfig");

    let tsconfig = Utf8Path::from_path(&dir)
        .expect("utf-8 path")
        .join("tsconfig.json");
    let mut source_api = TsgoApi::for_compilation(tsgo);
    let snapshot = source_api
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "the fixture should typecheck");
    let prepared = hir::prepare(&snapshot).expect("prepared HIR should verify");

    // LLVM.
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(
        llvm.diagnostics.is_empty(),
        "the LLVM backend declined: {:?}",
        llvm.diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    std::fs::write(dir.join("program.ll"), &llvm.text).expect("write the IR");

    // C.
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.diagnostics.is_empty(), "the C backend declined");
    std::fs::write(dir.join("program.c"), c.writer.text()).expect("write the C");
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .expect("write the runtime header");
    std::fs::write(dir.join("nts_runtime.c"), nts_codegen_c::RUNTIME_SOURCE)
        .expect("write the runtime");
    std::fs::write(dir.join("drive.c"), driver).expect("write the driver");

    let build = |args: &[&str], out: &str| -> bool {
        std::process::Command::new("clang")
            .args(["-w", "-O1"])
            .args(args)
            .arg("-I")
            .arg(&dir)
            .arg(dir.join("drive.c"))
            .arg("-lm")
            .arg("-o")
            .arg(dir.join(out))
            .output()
            .is_ok_and(|out| out.status.success())
    };
    let ll = dir.join("program.ll");
    let object = dir.join("program.o");
    let compiled_ir = std::process::Command::new("clang")
        .args(["-x", "ir", "-c", "-w"])
        .arg(&ll)
        .arg("-o")
        .arg(&object)
        .output()
        .is_ok_and(|out| out.status.success());
    assert!(compiled_ir, "clang rejected the emitted LLVM IR");
    // The runtime links into *both*, which is the arrangement that ships: one
    // hand-written C library, two code generators calling it. It is also the
    // only place the C-to-LLVM ABI is exercised.
    let program_c = dir.join("program.c");
    let runtime_c = dir.join("nts_runtime.c");
    assert!(
        build(&[object.to_str()?, runtime_c.to_str()?], "run_llvm"),
        "linking the IR against the runtime failed"
    );
    assert!(
        build(&[program_c.to_str()?, runtime_c.to_str()?], "run_c"),
        "building the C failed"
    );

    let read = |name: &str| -> String {
        let out = std::process::Command::new(dir.join(name))
            .output()
            .expect("the compiled program should run");
        assert!(out.status.success(), "{name} exited badly");
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    Some((read("run_llvm"), read("run_c")))
}

/// Arithmetic, comparison and control flow, over the hostile pool.
#[test]
fn the_two_backends_compute_the_same_numbers() {
    let source = r"
export function arithmetic(a: number, b: number): number {
  return a + b * 2 - a / 3;
}
export function ordering(a: number, b: number): number {
  if (a < b) { return -1; }
  if (a > b) { return 1; }
  if (a === b) { return 0; }
  return 7;
}
export function loops(n: number): number {
  let total = 0;
  let i = 0;
  while (i < 20) {
    total = total + i * n;
    i = i + 1;
  }
  return total;
}
";
    let driver = format!(
        r#"#include <stdio.h>
double arithmetic(double a, double b);
double ordering(double a, double b);
double loops(double n);
int main(void) {{
  double xs[] = {POOL};
  int count = (int)(sizeof xs / sizeof xs[0]);
  for (int i = 0; i < count; i++) {{
    printf("%a\n", loops(xs[i]));
    for (int j = 0; j < count; j++)
      printf("%a %a\n", arithmetic(xs[i], xs[j]), ordering(xs[i], xs[j]));
  }}
  return 0;
}}
"#
    );
    let Some((llvm, c)) = both_backends(source, &driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(
        llvm, c,
        "the two backends disagree, which is a backend bug by construction"
    );
}
