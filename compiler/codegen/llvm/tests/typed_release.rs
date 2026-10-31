//! Typed cleanup and collector tracing must execute across the C/LLVM runtime
//! boundary under both providers; source assertions cannot check a callback ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = concat!(
    include_str!("../../../../tests/programs/typed-release-fields/src/main.ts"),
    // Returned identity-bearing objects keep these environments and tuples
    // materialized. Scalar-only captures would not test managed-field tracing.
    r#"
export function ownedClosure(x: number): () => Leaf {
  const leaf = new Leaf(x);
  return () => leaf;
}
export function ownedTuple(x: number): [Leaf, Leaf, unknown] {
  const leaf = new Leaf(x);
  return [leaf, leaf, BigInt(x)];
}
"#
);
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
extern double typedGraph(double);
extern double cycleGraph(double);
extern double deepGraph(double);
extern NtsHeader *ownedGraph(double);
extern NtsHeader *ownedClosure(double);
extern NtsHeader *ownedTuple(double);
extern size_t descriptorSize(void);
extern size_t releaseFieldsOffset(void);
extern size_t traceFieldsOffset(void);
size_t nts_test_trace_calls;
#ifdef NTS_PROVIDER_RC
static NtsHeader *seen[4];
static size_t seen_count;
static void visit(NtsHeader *child) {
  if (seen_count < 4) seen[seen_count] = child;
  seen_count++;
}
#endif
int main(void) {
  if (descriptorSize() != sizeof(NtsDescriptor) ||
      releaseFieldsOffset() != offsetof(NtsDescriptor, release_fields) ||
      traceFieldsOffset() != offsetof(NtsDescriptor, trace_fields)) return 2;
  NtsHeader *owned = ownedGraph(5);
  const NtsDescriptor *descriptor = owned->descriptor;
  if (!descriptor->release_fields) {
    nts_release(owned);
    fputs("missing typed contents callback\n", stderr);
    return 3;
  }
  if (!descriptor->references || !descriptor->erased) return 4;
  nts_release(owned);
#ifdef NTS_PROVIDER_RC
  for (int n = 4; n < 8; n++) {
    owned = ownedGraph(n);
    descriptor = owned->descriptor;
    if (!descriptor->trace_fields) {
      nts_release(owned);
      fputs("missing typed trace callback\n", stderr);
      return 6;
    }
    /* Two inherited/private fields share a leaf. The erased slot alternates
     * between that leaf, string, boxed bigint and a scalar. Read expectations
     * through the ABI tables, independently of the callback's baked addresses. */
    if (descriptor->references != 2 || descriptor->erased != 1) return 7;
    NtsHeader *expected[3];
    uintptr_t counts[3];
    for (int i = 0; i < 2; i++)
      expected[i] = *(NtsHeader **)((char *)owned + descriptor->offsets[i]);
    NtsValue value = *(NtsValue *)((char *)owned + descriptor->erased_offsets[0]);
    expected[2] = NTS_TAG_IS_MANAGED(nts_value_tag(value))
                    ? nts_value_reference(value) : NULL;
    for (int i = 0; i < 3; i++) counts[i] = expected[i] ? expected[i]->reserved : 0;
    seen_count = 0;
    size_t calls = nts_test_trace_calls;
    descriptor->trace_fields(owned, visit);
    if (nts_test_trace_calls != calls + 1 || seen_count != (n == 7 ? 2u : 3u) ||
        seen[0] != expected[0] || seen[1] != expected[1] ||
        expected[0] != expected[1] || (n != 7 && seen[2] != expected[2])) return 8;
    for (int i = 0; i < 3; i++)
      if (expected[i] && expected[i]->reserved != counts[i]) return 9;
    calls = nts_test_trace_calls;
    nts_release(owned);
    if (nts_test_trace_calls != calls) return 10;
  }
  NtsHeader *fixed[2] = {ownedClosure(5), ownedTuple(5)};
  for (int i = 0; i < 2; i++) {
    owned = fixed[i];
    if (!owned->descriptor->trace_fields) return 14;
    seen_count = 0;
    owned->descriptor->trace_fields(owned, visit);
    if (seen_count != (i == 0 ? 1u : 3u)) return 15;
    if (i == 1 && (owned->descriptor->kind != NTS_KIND_TUPLE ||
                   seen[0] != seen[1] || seen[0] == seen[2])) return 16;
    size_t calls = nts_test_trace_calls;
    nts_release(owned);
    if (nts_test_trace_calls != calls) return 17;
  }
  /* The generic walk skips null slots before calling nts_release. The typed
   * callback must do so too: calls count even when the payload is null. */
  NtsHeader *empty = nts_object_new(descriptor);
  NtsValue *slot = (NtsValue *)((char *)empty + descriptor->erased_offsets[0]);
  *slot = nts_value_of_reference(NULL, NTS_TAG_OBJECT);
  nts_counting_reset();
  nts_release(empty);
  if (nts_counted_releases() != 1) return 5;
#else
  if (descriptor->trace_fields) return 11;
#endif
  for (int i = 0; i < 24; i++) {
    size_t calls = nts_test_trace_calls;
    printf("%.0f %.0f %.0f\n", typedGraph(i), cycleGraph(i), deepGraph(i));
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if (nts_test_trace_calls <= calls) return 12;
#else
    if (nts_test_trace_calls != calls) return 13;
#endif
  }
#ifdef NTS_PROVIDER_RC
  if (nts_live_count() != 0 || nts_live_bytes() != 0) return 1;
#endif
  return 0;
}
"#;

const C_ABI_QUERY: &str = "\nsize_t descriptorSize(void) { return sizeof(NtsDescriptor); }\n\
    size_t releaseFieldsOffset(void) { return offsetof(NtsDescriptor, release_fields); }\n\
    size_t traceFieldsOffset(void) { return offsetof(NtsDescriptor, trace_fields); }\n";
const LLVM_ABI_QUERY: &str = "\ndefine i64 @descriptorSize() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i64 1\n\
    %size = ptrtoint ptr %p to i64\n\
    ret i64 %size\n}\n\
    define i64 @releaseFieldsOffset() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i32 0, i32 14\n\
    %offset = ptrtoint ptr %p to i64\n\
    ret i64 %offset\n}\n\
    define i64 @traceFieldsOffset() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i32 0, i32 15\n\
    %offset = ptrtoint ptr %p to i64\n\
    ret i64 %offset\n}\n";

fn run_native(
    dir: &Utf8Path,
    provider: hir::Memory,
    input: &str,
    sources: &[std::path::PathBuf],
    expected_exit: i32,
) -> Vec<u8> {
    let binary = dir.join(format!("run-{input}-{provider:?}"));
    let mut cc = Command::new("clang");
    cc.current_dir(dir).args([
        "-std=c11",
        "-O1",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wno-override-module",
        "-I.",
    ]);
    if provider == hir::Memory::ReferenceCounting {
        cc.args([
            "-DNTS_PROVIDER_RC",
            "-DNTS_COUNT_OPERATIONS",
            "-DNTS_POISON=1",
            "-fsanitize=address,undefined",
            "-fno-sanitize-recover=all",
        ]);
    }
    let built = cc
        .arg(input)
        .arg("drive.c")
        .args(sources)
        .arg("-lm")
        .arg("-o")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{input}: {}",
        String::from_utf8_lossy(&built.stderr)
    );
    let run = Command::new("timeout")
        .arg("120")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        run.status.code() == Some(expected_exit),
        "{input}: expected exit {expected_exit}, got {:?}: {}",
        run.status,
        String::from_utf8_lossy(&run.stderr)
    );
    if matches!(expected_exit, 3 | 6) {
        let message = if expected_exit == 3 {
            b"missing typed contents callback\n".as_slice()
        } else {
            b"missing typed trace callback\n".as_slice()
        };
        assert_eq!(run.stderr, message);
        eprintln!("{input}: NULL callback slots rejected at execution (exit {expected_exit})");
    } else {
        assert!(run.stderr.is_empty(), "{input}: {:?}", run.stderr);
    }
    run.stdout
}

/// Leave the definitions intact, but disconnect every descriptor. The C
/// conditional still references the function so -Wunused-function cannot
/// substitute for the executed descriptor guard this control must reach.
fn without_descriptor_callbacks(source: &str, llvm: bool, prefix: &str) -> String {
    let mut changed = 0;
    let lines: Vec<String> = source
        .lines()
        .map(|line| {
            let (descriptor, marker) = if llvm {
                ("constant %NtsDescriptor", format!("ptr @{prefix}_"))
            } else {
                ("static const NtsDescriptor", format!("{prefix}_"))
            };
            if line.contains(descriptor)
                && let Some(start) = line.rfind(&marker)
            {
                let end = start
                    + marker.len()
                    + line[start + marker.len()..]
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .count();
                let callback = &line[start..end];
                let replacement = if llvm {
                    "ptr null".to_owned()
                } else {
                    format!("(0 ? {callback} : NULL)")
                };
                changed += 1;
                line.replacen(callback, &replacement, 1)
            } else {
                line.to_owned()
            }
        })
        .collect();
    assert!(changed > 0, "no descriptor callbacks found");
    lines.join("\n") + "\n"
}

fn check_unwired(dir: &Utf8Path, c: &str, llvm: &str, sources: &[std::path::PathBuf]) {
    for (prefix, exit) in [("__nts_release_fields", 3), ("__nts_trace_fields", 6)] {
        for (extension, source, is_llvm) in [("c", c, false), ("ll", llvm, true)] {
            let query = if is_llvm { LLVM_ABI_QUERY } else { C_ABI_QUERY };
            let input = format!("unwired-{prefix}.{extension}");
            std::fs::write(
                dir.join(&input),
                format!(
                    "{}{query}",
                    without_descriptor_callbacks(source, is_llvm, prefix)
                ),
            )
            .unwrap();
            run_native(dir, hir::Memory::ReferenceCounting, &input, sources, exit);
        }
    }
}

/// Observe actual collector dispatch in test copies only. A correct answer
/// with unused callback definitions is insufficient: the generic walk could
/// have produced it. Every instrumented definition is counted at entry.
fn count_traces(source: &str, llvm: bool) -> String {
    let mut out = if llvm {
        "@nts_test_trace_calls = external global i64\n".to_owned()
    } else {
        "extern unsigned long nts_test_trace_calls;\n".to_owned()
    };
    let mut entry = false;
    for line in source.lines() {
        out.push_str(line);
        out.push('\n');
        if llvm {
            if line.starts_with("define internal void @__nts_trace_fields_") {
                entry = true;
            } else if entry && line == "entry:" {
                out.push_str("  %test.before = load i64, ptr @nts_test_trace_calls\n  %test.after = add i64 %test.before, 1\n  store i64 %test.after, ptr @nts_test_trace_calls\n");
                entry = false;
            }
        } else if line.starts_with("static void __nts_trace_fields_") {
            out.push_str("    nts_test_trace_calls++;\n");
        }
    }
    assert!(!entry, "trace callback had no entry block");
    out
}

fn cross_compile(dir: &Utf8Path, program: &hir::Program) {
    use nts_codegen_llvm::{Arch, Platform};
    let targets = [
        (Platform::SYSV_X86_64, "x86_64-unknown-linux-gnu"),
        (Platform::WIN64_X86_64, "x86_64-pc-windows-msvc"),
        (Platform::APPLE_ARM64, "arm64-apple-macosx11.0.0"),
        (Platform::LINUX_ARM64, "aarch64-unknown-linux-gnu"),
        (Platform::WINDOWS_ARM64, "aarch64-pc-windows-msvc"),
        (
            Platform {
                abi: hir::native::NativeAbi::LP64,
                arch: Arch::X86_64,
                darwin: true,
            },
            "x86_64-apple-macosx11.0.0",
        ),
    ];
    for (platform, target) in targets {
        let module = nts_codegen_llvm::emit(program, platform);
        assert!(
            module.diagnostics.is_empty(),
            "{target}: {:?}",
            module.diagnostics
        );
        let path = dir.join(format!("{target}.ll"));
        std::fs::write(&path, module.text).unwrap();
        let assembled = Command::new("clang")
            .args(["-target", target, "-Werror", "-Wno-override-module", "-c"])
            .arg(&path)
            .arg("-o")
            .arg(dir.join(format!("{target}.o")))
            .output()
            .unwrap();
        assert!(
            assembled.status.success(),
            "{target}: {}",
            String::from_utf8_lossy(&assembled.stderr)
        );
    }
}

#[test]
fn typed_release_callbacks_execute_with_both_providers_and_native_emitters() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/typed-release-tests"), "callbacks");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
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
    std::fs::write(dir.join("drive.c"), DRIVER).unwrap();
    let mut baseline = None;
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
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
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        assert!(
            c.writer
                .text()
                .contains("static void __nts_release_fields_")
        );
        assert!(
            llvm.text
                .contains("define internal void @__nts_release_fields_")
        );
        let counted = provider == hir::Memory::ReferenceCounting;
        assert_eq!(
            c.writer.text().contains("static void __nts_trace_fields_"),
            counted
        );
        assert_eq!(
            llvm.text
                .contains("define internal void @__nts_trace_fields_"),
            counted
        );
        // Foreign tags must not take the generated managed-edge path.
        assert!(!c.writer.text().contains("nts_value_release(slot_"));
        std::fs::write(
            dir.join("program.c"),
            format!("{}{C_ABI_QUERY}", count_traces(c.writer.text(), false)),
        )
        .unwrap();
        std::fs::write(
            dir.join("program.ll"),
            format!("{}{LLVM_ABI_QUERY}", count_traces(&llvm.text, true)),
        )
        .unwrap();
        let mut sources = Vec::new();
        for file in c.support_files() {
            let path = file.write(dir.as_std_path()).unwrap();
            if file.compiled {
                sources.push(path);
            }
        }
        for input in ["program.c", "program.ll"] {
            let output = run_native(&dir, provider, input, &sources, 0);
            if let Some(expected) = &baseline {
                assert_eq!(&output, expected);
            } else {
                baseline = Some(output);
            }
        }
        if provider == hir::Memory::ReferenceCounting {
            cross_compile(&dir, &prepared.program);
            check_unwired(&dir, c.writer.text(), &llvm.text, &sources);
        }
    }
}
