//! A dispatch target which resumes a task has one physical receiver type.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::Frontend;
use std::{collections::HashSet, process::Command};

const SUBJECT: &str = r"
let result = 0;
async function* source(): AsyncGenerator<number> {
  const value = await Promise.resolve(7);
  yield value;
}
async function drain(values: AsyncGenerator<number>): Promise<number> {
  for await (const value of values) result += value;
  return result;
}
export async function collect(): Promise<number> { return await drain(source()); }
export function start(): void { result=0; void collect(); }
export function answer(): number { return result; }
";

#[test]
fn task_and_dispatch_roles_share_the_definition_and_call_type() {
    let mut failures = Vec::new();
    for (case, source) in [
        ("control", SUBJECT.replace("await Promise.resolve(7)", "7")),
        ("dual-role", SUBJECT.to_owned()),
    ] {
        for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
            failures.extend(execute(case, &source, provider));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn execute(case: &str, source: &str, provider: hir::Memory) -> Vec<String> {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/task-receiver-roles"), case);
    std::fs::write(dir.join("main.ts"), source).unwrap();
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
            provider,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let program = &prepared.program;
    let plan = nts_codegen_c::EntryAbi::new(program);
    let c = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let published = c.published_entries(&plan).unwrap();
    let tasks: HashSet<_> = program
        .funcs
        .iter()
        .flat_map(|f| {
            f.blocks.iter().flat_map(|b| &b.ops).filter_map(|v| {
                if let OpKind::Suspend { resume, .. } = &f.value(*v).kind {
                    Some(resume.as_str())
                } else {
                    None
                }
            })
        })
        .collect();
    let mut dual = HashSet::new();
    for layout in &program.layouts {
        for (slot, name) in layout.methods.iter().enumerate() {
            if let Some(name) = name.as_deref().filter(|name| tasks.contains(name)) {
                let function = program.funcs.iter().find(|f| f.name == name).unwrap();
                let Some(entry) = published
                    .dispatch(layout, u32::try_from(slot).unwrap())
                    .unwrap()
                else {
                    continue;
                };
                assert!(std::ptr::eq(entry.function, function));
                let definition = published.function(function).unwrap().unwrap();
                assert_eq!(entry.parameters, ["void *"]);
                assert_eq!(definition.parameters, entry.parameters);
                assert_eq!(definition.result, entry.result);
                assert_eq!(definition.symbol, entry.symbol, "no receiver adapter");
                dual.insert(name);
            }
        }
    }
    assert_eq!(dual.len(), usize::from(case == "dual-role"), "{dual:?}");
    let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    for name in &dual {
        let function = program.funcs.iter().find(|f| f.name == *name).unwrap();
        let entry = published.function(function).unwrap().unwrap();
        let definition = llvm
            .text
            .lines()
            .find(|line| {
                line.starts_with("define ") && line.contains(&format!("@{}(", entry.symbol))
            })
            .unwrap();
        assert!(
            definition.contains(&format!("void @{}(ptr ", entry.symbol)),
            "{definition}"
        );
    }
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
    run(&dir, case, provider)
}

fn run(dir: &Utf8Path, case: &str, provider: hir::Memory) -> Vec<String> {
    let mut failures = Vec::new();
    for (backend, source) in [("c", "program.c"), ("llvm", "program.ll")] {
        let binary = dir.join(format!("caller-{backend}"));
        let mut command = Command::new("clang");
        command
            .current_dir(dir)
            .args([
                "-O1",
                "-fsanitize=function",
                "-fno-sanitize-recover=function",
                "-Wno-override-module",
                "-I.",
                source,
                "caller.c",
                "nts_runtime.c",
                "nts_test_host.c",
                "-lm",
                "-o",
            ])
            .arg(&binary);
        if provider == hir::Memory::ReferenceCounting {
            command.arg("-DNTS_PROVIDER_RC");
        }
        let linked = command.output().unwrap();
        if !linked.status.success() {
            failures.push(format!(
                "{case}/{provider:?}/{backend} link: {}",
                String::from_utf8_lossy(&linked.stderr)
            ));
            continue;
        }
        let output = Command::new(&binary).output().unwrap();
        println!(
            "{case}/{provider:?}/{backend}: {:?} {} {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success() || output.stdout != b"7\n" {
            failures.push(format!("{case}/{provider:?}/{backend}: {output:?}"));
        }
    }
    failures
}

const CALLER: &str = r#"
#include "program.h"
#include "nts_test_host.h"
#include <stdio.h>
int main(void) {
  nts_test_host_install(); start(); nts_test_host_run(256);
  printf("%.0f\n", answer());
  return answer() == 7 ? 0 : 1;
}
"#;
