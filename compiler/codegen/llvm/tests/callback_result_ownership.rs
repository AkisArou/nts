//! A void host reader must release an owned result discarded by its adapter.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

const SUBJECT: &str = r"
let answer=0;
export function run(n:number):void {
  setTimeout(()=> { answer=n; return {value:n}; },0);
}
export function readAnswer():number { return answer; }
";

#[test]
fn a_host_ignoring_a_callback_result_releases_its_owned_reference() {
    let mut failures = Vec::new();
    for (case, source) in cases() {
        failures.extend(execute(case, &source));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn cases() -> Vec<(&'static str, String)> {
    vec![
        (
            "control",
            SUBJECT.replace("return {value:n};", "void {value:n};"),
        ),
        ("reference", SUBJECT.to_owned()),
        (
            "borrowed-source",
            SUBJECT
                .replace("  setTimeout", "  const kept={value:n};\n  setTimeout")
                .replace("return {value:n};", "return kept;"),
        ),
        ("erased-reference", SUBJECT.replace("()=>", "():unknown=>")),
        (
            "erased-number",
            SUBJECT
                .replace("()=>", "():unknown=>")
                .replace("return {value:n};", "return n;"),
        ),
        (
            "optional-reference",
            SUBJECT
                .replace("()=>", "():{value:number}|undefined=>")
                .replace("return {value:n};", "return n ? {value:n} : undefined;"),
        ),
        (
            "foreign-control",
            foreign_source().replace("return thing_new_owned();", "void thing_new_owned();"),
        ),
        ("foreign-reference", foreign_source()),
    ]
}

fn foreign_source() -> String {
    format!(
        r#"
import type {{ GObjectClass, Owned }} from "c:types";
type Thing = GObjectClass<"_Thing">;
declare function thing_new_owned(): Owned<Thing>;
{}"#,
        SUBJECT.replace("return {value:n};", "return thing_new_owned();")
    )
}

fn execute(case: &str, source: &str) -> Vec<String> {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let mut failures = Vec::new();
    let dir = scratch::ScratchDir::new(&root.join("target/callback-result-ownership"), case);
    std::fs::write(dir.join("main.ts"), source).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\",\"{root}/runtime/native/libc.d.ts\"]}}"),
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
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.h"), &c.header).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for support in c.support_files() {
        support.write(dir.as_std_path()).unwrap();
    }
    for file in ["nts_test_host.h", "nts_test_host.c"] {
        std::fs::copy(root.join("runtime/c").join(file), dir.join(file)).unwrap();
    }
    std::fs::write(dir.join("caller.c"), CALLER).unwrap();
    std::fs::write(dir.join("foreign.c"), FOREIGN).unwrap();
    for (backend, source) in [("c", "program.c"), ("llvm", "program.ll")] {
        let binary = dir.join(format!("caller-{backend}"));
        let linked = Command::new("clang")
            .current_dir(&dir)
            .args([
                "-std=c11",
                "-O1",
                "-DNTS_PROVIDER_RC",
                "-Wno-override-module",
                "-I.",
                source,
                "caller.c",
                "nts_runtime.c",
                "nts_test_host.c",
                "foreign.c",
                "-lm",
                "-o",
            ])
            .arg(&binary)
            .output()
            .unwrap();
        if !linked.status.success() {
            failures.push(format!(
                "{case}/{backend} link: {}",
                String::from_utf8_lossy(&linked.stderr)
            ));
            continue;
        }
        let ran = Command::new(&binary).output().unwrap();
        println!(
            "{case}/{backend}: {:?} {} {}",
            ran.status.code(),
            String::from_utf8_lossy(&ran.stdout),
            String::from_utf8_lossy(&ran.stderr)
        );
        if !ran.status.success() {
            failures.push(format!(
                "{case}/{backend}: {} {}",
                String::from_utf8_lossy(&ran.stdout),
                String::from_utf8_lossy(&ran.stderr)
            ));
        }
    }
    failures
}

const CALLER: &str = r#"
#include "program.h"
#include "nts_test_host.h"
#include <stdio.h>
extern int native_live(void);
int main(void) {
  nts_test_host_install(); run(0.0); nts_test_host_run(8); nts_collect_cycles();
  size_t before=nts_live_count();
  for(int i=0;i<16;i++) { run(7.0); nts_test_host_run(8); }
  nts_collect_cycles();
  long delta=(long)nts_live_count()-(long)before;
  printf("live_delta=%ld answer=%.0f\n",delta,readAnswer());
  return delta==0 && readAnswer()==7.0 && native_live()==0 ? 0 : 1;
}
"#;

const FOREIGN: &str = r"
#include <stdlib.h>
struct _Thing { int references; };
static int live;
int native_live(void) { return live; }
struct _Thing *thing_new_owned(void) { struct _Thing *p=malloc(sizeof *p); p->references=1; live++; return p; }
void *g_object_ref(void *opaque) { struct _Thing *p=opaque; p->references++; return p; }
void g_object_unref(void *opaque) { struct _Thing *p=opaque; if (--p->references==0) { live--; free(p); } }
";
