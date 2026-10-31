//! Virtual and direct physical tails borrow references; the caller owns temporaries.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

fn source(kind: &str) -> String {
    let (ty, expression, declaration) = match kind {
        "object" => (
            "Cell",
            "new Cell(n)",
            "class Cell { constructor(public value:number){} }",
        ),
        "string" => ("string", "'value=' + n", ""),
        "closure" => ("()=>number", "()=>n", ""),
        "boxed-bigint" => ("unknown", "BigInt(n|0)", ""),
        _ => unreachable!(),
    };
    format!(
        r"
{declaration}
let kept:({ty})|undefined;
class Base {{ read(value:{ty}):number {{ kept=value; return 17; }} }}
class Child extends Base {{ override read():number {{ return 17; }} }}
function invoke(value:Base,n:number):number {{ return value.read({expression}); }}
export function root(n:number):number {{
 const receiver:Base=n<0 ? new Base() : new Child();
 const answer=invoke(receiver,n); kept=undefined; return answer;
}}
export function direct():number {{ return new Child().read(); }}
"
    )
}

#[test]
fn ignored_reference_arguments_and_direct_fillers_have_no_owned_tail() {
    let mut failures = Vec::new();
    for kind in ["object", "string", "closure", "boxed-bigint"] {
        failures.extend(execute(kind));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn execute(kind: &str) -> Vec<String> {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/entry-tail-ownership"), kind);
    std::fs::write(dir.join("main.ts"), source(kind)).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{kind}: {:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(c.is_complete(), "{kind}: {:?}", c.diagnostics);
    assert!(
        llvm.diagnostics.is_empty(),
        "{kind}: {:?}",
        llvm.diagnostics
    );
    assert!(
        c.writer.text().contains("__nts_ignored0"),
        "must retain an ignored physical tail: {kind}"
    );
    if kind == "boxed-bigint" {
        assert!(
            c.writer.text().contains("nts_bigint_box"),
            "must exercise a heap BigInt: {}",
            c.writer.text()
        );
    }
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.h"), &c.header).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("caller.c"), CALLER).unwrap();
    run_outputs(kind, &dir)
}

fn run_outputs(kind: &str, dir: &Utf8Path) -> Vec<String> {
    let mut failures = Vec::new();
    for (backend, input, sanitize) in [
        ("c", "program.c", false),
        ("llvm", "program.ll", false),
        ("c-asan", "program.c", true),
    ] {
        let binary = dir.join(format!("caller-{backend}"));
        let mut command = Command::new("clang");
        command
            .current_dir(dir)
            .args([
                "-std=c11",
                "-O1",
                "-g",
                "-DNTS_PROVIDER_RC",
                "-Wno-override-module",
                "-I.",
                input,
                "caller.c",
                "nts_runtime.c",
                "-lm",
                "-o",
            ])
            .arg(&binary);
        if sanitize {
            command.args(["-fsanitize=address", "-fno-sanitize-recover=all"]);
        }
        let linked = command.output().unwrap();
        if !linked.status.success() {
            failures.push(format!(
                "{kind}/{backend}: {}",
                String::from_utf8_lossy(&linked.stderr)
            ));
            continue;
        }
        let output = Command::new(&binary)
            .env("ASAN_OPTIONS", "detect_leaks=0:halt_on_error=1")
            .output()
            .unwrap();
        println!(
            "{kind}/{backend}: {:?} {} {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success() || !output.stderr.is_empty() {
            failures.push(format!(
                "{kind}/{backend}: {} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    failures
}

const CALLER: &str = r#"
#include "program.h"
#include <stdio.h>
int main(void) {
  root(-1.0); root(1.0); direct(); nts_collect_cycles();
  size_t before=nts_live_count();
  const int sizes[]={16,64,256};
  for(unsigned k=0;k<3;k++) {
    int n=sizes[k];
    for(int i=0;i<n;i++) if(root((double)i)!=17.0) return 2;
    nts_collect_cycles(); long root_delta=(long)nts_live_count()-(long)before;
    for(int i=0;i<n;i++) if(direct()!=17.0) return 3;
    nts_collect_cycles(); long direct_delta=(long)nts_live_count()-(long)before;
    printf("n=%d root_live_delta=%ld direct_live_delta=%ld\n",n,root_delta,direct_delta);
    if(root_delta || direct_delta) return 1;
  }
  return 0;
}
"#;
