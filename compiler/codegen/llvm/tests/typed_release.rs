//! Typed cleanup and collector tracing must execute across the C/LLVM runtime
//! boundary under both providers; source assertions cannot check a callback ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

use crate::scratch;
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
// An array of references uses the runtime's own descriptor on both emitters;
// its null slots must not reach a counted release.
export function ownedLeaves(x: number): (Leaf | null)[] {
  const leaves: (Leaf | null)[] = [];
  for (let i = 0; i < 64; i++) leaves.push((i & 1) === 0 ? new Leaf(x + i) : null);
  return leaves;
}
class Message {
  constructor(readonly prefix: number, readonly message: string, readonly suffix: string) {}
}
export function messageObject(): Message { return new Message(7, 'kept', 'other'); }
export function messageCapture(message: string): () => string { return () => message; }
export function textCapture(text: string): () => string { return () => text; }
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
extern NtsHeader *ownedLeaves(double);
extern NtsHeader *messageObject(void);
extern NtsHeader *messageCapture(NtsString *);
extern NtsHeader *textCapture(NtsString *);
extern size_t descriptorSize(void);
extern size_t releaseFieldsOffset(void);
extern size_t traceFieldsOffset(void);
extern size_t messageOffsetOffset(void);
extern size_t releaseForeignOffset(void);
size_t nts_test_trace_calls;
static NtsLanding message_landing;
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
      traceFieldsOffset() != offsetof(NtsDescriptor, trace_fields) ||
      messageOffsetOffset() != offsetof(NtsDescriptor, message_offset) ||
      releaseForeignOffset() != offsetof(NtsDescriptor, release_foreign)) return 2;
  /* Exercise the offset the emitter published, and the reporter reading it
   * from an erased value. A differently typed field precedes the message. */
  NtsHeader *message = messageObject();
  if (!message->descriptor->message_offset) return 20;
  /* Numbers and strings only: nothing foreign, so nothing to give up. */
  if (message->descriptor->release_foreign) return 26;
  NtsString *detail = *(NtsString **)((char *)message + message->descriptor->message_offset);
  if (!detail || detail->length != 4 || nts_unit(detail, 0) != 'k') return 21;
  if (setjmp(message_landing.frame) == 0) {
    nts_landing_push(&message_landing);
    nts_uncaught(nts_value_of_reference(message, NTS_TAG_OBJECT), NULL);
  }
  if (nts_landing_detail(&message_landing) != detail ||
      nts_value_reference(nts_landing_thrown(&message_landing)) != message) return 22;
  nts_release(message);
  /* Capture names are lexical storage, never properties of the function.
   * Both native emitters must publish no projection for either spelling. */
  NtsHeader *captures[2] = {messageCapture(NULL), textCapture(NULL)};
  for (int i = 0; i < 2; i++) {
    if (captures[i]->descriptor->message_offset) return 23;
    if (setjmp(message_landing.frame) == 0) {
      nts_landing_push(&message_landing);
      nts_uncaught(nts_value_of_reference(captures[i], NTS_TAG_FUNCTION), NULL);
    }
    if (nts_landing_detail(&message_landing) != NULL ||
        nts_value_reference(nts_landing_thrown(&message_landing)) != captures[i]) return 24;
    nts_release(captures[i]);
  }
  NtsHeader *owned = ownedGraph(5);
  const NtsDescriptor *descriptor = owned->descriptor;
  if (!descriptor->release_fields) {
    nts_release(owned);
    fputs("missing typed contents callback\n", stderr);
    return 3;
  }
  if (!descriptor->references || !descriptor->erased) return 4;
  /* A generated layout with an erased slot gives its foreign contents up
   * through the runtime's walk over its tables; one with none names nothing,
   * so its frees ask one field and stop. */
  if (descriptor->release_foreign != nts_release_foreign) return 25;
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
  /* A compiled array of references dies through the runtime's shared
   * pointer-slot callback: one release for it and one per non-null slot.
   * Which of the two runtime descriptors it gets is the cycle analysis's
   * answer for this program (`payload: unknown` can hold a Leaf). */
  NtsHeader *leaves = ownedLeaves(5);
  if ((leaves->descriptor != &nts_desc_ref &&
       leaves->descriptor != &nts_desc_ref_acyclic) ||
      !leaves->descriptor->release_fields ||
      leaves->descriptor->release_fields != nts_desc_ref_acyclic.release_fields) {
    nts_release(leaves);
    return 18;
  }
  nts_counting_reset();
  nts_release(leaves);
  if (nts_counted_releases() != 1 + 32) return 19;
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
  NtsHeader *leaves = ownedLeaves(5);
  bool shared = leaves->descriptor->release_fields &&
                leaves->descriptor->release_fields == nts_desc_ref.release_fields;
  nts_release(leaves);
  if (!shared) return 18;
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
    size_t traceFieldsOffset(void) { return offsetof(NtsDescriptor, trace_fields); }\n\
    size_t messageOffsetOffset(void) { return offsetof(NtsDescriptor, message_offset); }\n\
    size_t releaseForeignOffset(void) { return offsetof(NtsDescriptor, release_foreign); }\n";
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
    ret i64 %offset\n}\n\
    define i64 @messageOffsetOffset() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i32 0, i32 16\n\
    %offset = ptrtoint ptr %p to i64\n\
    ret i64 %offset\n}\n\
    define i64 @releaseForeignOffset() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i32 0, i32 17\n\
    %offset = ptrtoint ptr %p to i64\n\
    ret i64 %offset\n}\n";

fn run_native(
    dir: &Utf8Path,
    provider: hir::Memory,
    input: &str,
    sources: &[std::path::PathBuf],
    expected_exit: i32,
    expected_report: Option<&str>,
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
    if let Some(report) = expected_report {
        assert_eq!(run.stderr, report.as_bytes(), "{input}");
    } else if matches!(expected_exit, 3 | 6) {
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
            run_native(
                dir,
                hir::Memory::ReferenceCounting,
                &input,
                sources,
                exit,
                None,
            );
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
        if platform == Platform::WINDOWS_ARM64 {
            for helper in ["nts_value_release", "nts_value_retain", "nts_is_class"] {
                assert!(
                    module.text.lines().any(|line| {
                        line.contains("call ") && line.contains(&format!("@{helper}([2 x i64] "))
                    }),
                    "{target}: missing two-word {helper} call"
                );
            }
        }
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
                ..hir::Options::new(
                    nts_core::hir::backend::Backend::Llvm,
                    nts_core::hir::EntryUnwind::Terminal,
                )
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
            let output = run_native(&dir, provider, input, &sources, 0, None);
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

#[test]
fn throwing_and_rejecting_a_function_does_not_report_its_captured_message() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    for capture in ["message", "text"] {
        for action in [
            "throw f",
            "Promise.reject(f)",
            "Promise.resolve(0).then(()=>{throw f})",
        ] {
            let dir = ScratchDir::new(&root.join("target/typed-release-tests"), "thrown-capture");
            std::fs::write(
                dir.join("main.ts"),
                format!("function make({capture}:string):()=>string{{return ()=>{capture}}} export function run():void{{const f=make('captured-secret'); if(f()!=='captured-secret')throw 'bad capture'; {action};}}"),
            ).unwrap();
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
            std::fs::write(dir.join("drive.c"), "#include \"nts_runtime.h\"\nextern void run(void);\nint main(void) { nts_enter(); run(); nts_leave(); return 0; }\n").unwrap();
            for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
                let prepared = hir::prepare_with(
                    &snapshot,
                    &hir::Options {
                        provider,
                        ..hir::Options::new(
                            nts_core::hir::backend::Backend::Llvm,
                            nts_core::hir::EntryUnwind::Terminal,
                        )
                    },
                )
                .unwrap();
                assert!(
                    prepared.diagnostics.is_empty(),
                    "{:?}",
                    prepared.diagnostics
                );
                assert!(
                    prepared.program.uncompiled.is_empty(),
                    "{:?}",
                    prepared.program.uncompiled
                );
                let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
                let llvm = nts_codegen_llvm::emit(
                    &prepared.program,
                    nts_codegen_llvm::Platform::SYSV_X86_64,
                );
                assert!(c.is_complete(), "{:?}", c.diagnostics);
                assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
                std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
                std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
                let sources: Vec<_> = c
                    .support_files()
                    .iter()
                    .filter_map(|file| {
                        let path = file.write(dir.as_std_path()).unwrap();
                        file.compiled.then_some(path)
                    })
                    .collect();
                for input in ["program.c", "program.ll"] {
                    assert_eq!(
                        run_native(
                            &dir,
                            provider,
                            input,
                            &sources,
                            1,
                            Some("nts: uncaught Closure0\n")
                        ),
                        [] as [u8; 0]
                    );
                }
            }
        }
    }
}

/// The source of `typed_releases_follow_the_proved_layout_graph`: a chain of
/// `TYPED_RELEASE_DEPTH + 2` classes, each holding the next, beside a subtype
/// in a base-typed field, an erased field and a cyclic class.
fn graph_source() -> String {
    use std::fmt::Write as _;
    let length = nts_codegen_common::release::TYPED_RELEASE_DEPTH + 2;
    let mut source = String::from(
        "class Note { size: number; constructor(size: number) { this.size = size; } }\n\
         class Leaf { value: number; constructor(value: number) { this.value = value; } }\n\
         class Heavy extends Leaf {\n\
           note: Note;\n\
           constructor(value: number) { super(value); this.note = new Note(value + 1); }\n\
         }\n\
         class Pair { left: Leaf; right: Leaf; constructor(left: Leaf, right: Leaf) { this.left = left; this.right = right; } }\n\
         class Opaque { held: unknown; constructor(held: unknown) { this.held = held; } }\n\
         class Ring { weight: number; next: Ring | null = null; constructor(weight: number) { this.weight = weight; } }\n\
         export function makePairs(x: number): Pair[] {\n\
           const pairs: Pair[] = [];\n\
           for (let i = 0; i < 4; i++) pairs.push(new Pair(new Leaf(x + i), new Heavy(x - i)));\n\
           return pairs;\n\
         }\n\
         export function makeOpaque(x: number): Opaque { return new Opaque(new Leaf(x)); }\n\
         export function makeRing(x: number): Ring { const ring = new Ring(x); ring.next = new Ring(x + 1); return ring; }\n\
         export function work(x: number): number { return makePairs(x).length; }\n",
    );
    for at in 0..length - 1 {
        let next = at + 1;
        let _ = writeln!(
            source,
            "class C{at} {{ next: C{next}; constructor(next: C{next}) {{ this.next = next; }} }}"
        );
    }
    let last = length - 1;
    let _ = writeln!(
        source,
        "class C{last} {{ depth: number; constructor(depth: number) {{ this.depth = depth; }} }}"
    );
    let mut chain = format!("new C{last}(x)");
    for at in (0..last).rev() {
        chain = format!("new C{at}({chain})");
    }
    let _ = writeln!(
        source,
        "export function makeChain(x: number): C0 {{ return {chain}; }}"
    );
    source
}

/// Deaths each released graph must finish in a typed release. The chain is
/// released by the runtime from C, so `C0` dies generically; `C1`'s typed
/// release is the one the depth bound stops, handing `C2` to `nts_release`;
/// `C3` onwards die typed again. The pairs' array is proved acyclic, so its
/// typed descriptor releases four pairs through `Pair`'s typed release; their
/// plain leaves die typed, each `Heavy` does not, and its note dies typed from
/// the generic death's contents callback. The erased field and the cyclic
/// class have none. `Ring` names its number `weight`: a `Leaf` slot can hold
/// any object laid out like one, and a `Ring` with a leading `value` would
/// make the pairs' array cyclic. A release that trusted the static type would
/// also count twelve, and leave the four notes alive.
///
/// Each phase also prints the retains and releases it counted, which a
/// counting build of either backend must agree on.
const GRAPH_DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
#include <stdlib.h>
extern NtsHeader *makeChain(double);
extern NtsHeader *makePairs(double);
extern NtsHeader *makeOpaque(double);
extern NtsHeader *makeRing(double);
/* A failed check exits at once: the leak a control makes is this driver's
   to report, before LeakSanitizer's exit report could replace its status. */
static void expect(int holds, int status) {
  if (!holds) _Exit(status);
}
static void counted(const char *phase) {
  printf("%s retains=%zu releases=%zu\n", phase, nts_counted_retains(),
         nts_counted_releases());
}
int main(void) {
  size_t base = nts_live_count();
  nts_counting_reset();
  nts_release(makeChain(3));
  expect(nts_counted_typed_deaths() == CHAIN_TYPED, 30);
  counted("chain");
  nts_counting_reset();
  nts_release(makePairs(3));
  expect(nts_counted_typed_deaths() == 12, 31);
  counted("pairs");
  nts_counting_reset();
  nts_release(makeOpaque(3));
  nts_release(makeRing(3));
  expect(nts_counted_typed_deaths() == 0, 32);
  counted("generic");
  nts_collect_cycles();
  expect(nts_live_count() == base, 33);
  return 0;
}
"#;

/// Make every typed release assume its layout, as a release that trusted the
/// static type would: the descriptor comparison no longer decides anything.
fn assuming_the_static_layout(source: &str, llvm: bool) -> String {
    let mut changed = 0;
    let lines: Vec<String> = source
        .lines()
        .map(|line| {
            if llvm && line.starts_with("  %mine0 = or i1 false, ") {
                changed += 1;
                line.replace("or i1 false, ", "or i1 true, ")
            } else if !llvm
                && line.starts_with("    if (!__nts_object || (")
                && line.contains("->descriptor != &")
            {
                changed += 1;
                "    if (!__nts_object) {".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect();
    assert!(changed > 0, "no typed release comparison found");
    lines.join("\n") + "\n"
}

/// What the shared plan decides for `graph_source`'s layouts.
fn check_graph_plan(program: &hir::Program) {
    use nts_codegen_common::release::{TYPED_RELEASE_DEPTH, TypedReleases};
    let cycles = program.cycles();
    let plan = TypedReleases::plan(program, &cycles);
    let layout = |name: &str| {
        program
            .layouts
            .iter()
            .position(|layout| layout.name == name)
            .unwrap_or_else(|| panic!("no layout {name}"))
    };
    // Proved acyclic, with no erased or foreign slot: specialized.
    for name in ["Note", "Leaf", "Heavy", "Pair"] {
        assert!(
            plan.of(layout(name)).is_some(),
            "{name} has no typed release"
        );
    }
    // Acyclic only if an erased field's contents are ignored: the cycle graph
    // treats `unknown` as reaching every layout, and an erased slot is the
    // clear-before-release protocol's either way.
    assert!(plan.of(layout("Opaque")).is_none());
    assert!(cycles.cyclic[layout("Opaque")]);
    // Cyclic: the collector's candidate rules stay the runtime's.
    assert!(plan.of(layout("Ring")).is_none());
    // Every chain of typed deaths stays within the bound, and the release
    // whose child would pass it hands that child to `nts_release`.
    let length = TYPED_RELEASE_DEPTH + 2;
    for at in 0..length {
        let typed = plan.of(layout(&format!("C{at}"))).unwrap();
        assert!(typed.depth <= TYPED_RELEASE_DEPTH, "C{at}: {typed:?}");
    }
    assert_eq!(plan.of(layout("C2")).unwrap().depth, TYPED_RELEASE_DEPTH);
    assert_eq!(plan.of(layout("C1")).unwrap().children, [None]);
    assert_eq!(plan.of(layout("C1")).unwrap().depth, 1);
    assert_eq!(
        plan.of(layout("C0")).unwrap().children,
        [Some(layout("C1"))]
    );
    assert_eq!(
        plan.of(layout("C3")).unwrap().children,
        [Some(layout("C4"))]
    );
}

#[test]
fn typed_releases_follow_the_proved_layout_graph() {
    use nts_codegen_common::release::TYPED_RELEASE_DEPTH;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/typed-release-tests"), "graph");
    std::fs::write(dir.join("main.ts"), graph_source()).unwrap();
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
            ..hir::Options::new(
                nts_core::hir::backend::Backend::Llvm,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let program = &prepared.program;
    let length = TYPED_RELEASE_DEPTH + 2;
    check_graph_plan(program);

    let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
    let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let llvm_counted = counted_module(program, &llvm.text);
    for absent in ["Opaque", "Ring"] {
        assert!(
            !c.writer
                .text()
                .contains(&format!("__nts_typed_release_NtsObj_{absent}"))
        );
        assert!(
            !llvm
                .text
                .contains(&format!("@__nts_typed_release_{absent}("))
        );
    }
    let chain_typed = length - 2;
    std::fs::write(
        dir.join("drive.c"),
        GRAPH_DRIVER.replace("CHAIN_TYPED", &chain_typed.to_string()),
    )
    .unwrap();
    let mut sources = Vec::new();
    for file in c.support_files() {
        let path = file.write(dir.as_std_path()).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let mut counts = Vec::new();
    for (input, text, is_llvm) in [
        ("graph.c", c.writer.text(), false),
        ("graph.ll", llvm_counted.as_str(), true),
        ("graph-uncounted.ll", llvm.text.as_str(), true),
    ] {
        std::fs::write(dir.join(input), text).unwrap();
        counts.push(run_native(
            &dir,
            hir::Memory::ReferenceCounting,
            input,
            &sources,
            0,
            None,
        ));
        // The control: the same program with each typed release trusting the
        // static type. A `Heavy` then dies as a `Leaf`, and its note is never
        // released.
        let assumed = format!("assumed-{input}");
        std::fs::write(
            dir.join(&assumed),
            assuming_the_static_layout(text, is_llvm),
        )
        .unwrap();
        run_native(
            &dir,
            hir::Memory::ReferenceCounting,
            &assumed,
            &sources,
            33,
            None,
        );
    }
    check_counts_agree(&counts);
    check_memory_harness(&dir, &sources);
}

/// The graph's LLVM module emitted for a counting build, checked against the
/// ordinary one (`check_counting_hooks`).
fn counted_module(program: &hir::Program, ordinary: &str) -> String {
    let counted = nts_codegen_llvm::emit_with_source_symbols(
        program,
        nts_codegen_llvm::Platform::SYSV_X86_64,
        std::rc::Rc::new(nts_codegen_common::source_symbols::SourceSymbols::new(
            program,
        )),
        nts_codegen_common::release::Counting::Operations,
    );
    assert!(counted.diagnostics.is_empty(), "{:?}", counted.diagnostics);
    check_counting_hooks(ordinary, &counted.text);
    counted.text
}

/// A counting build counts the same operations on both backends: C's
/// report, then the counting LLVM build's. The control, third: an ordinary
/// LLVM build in the same counting runtime misses each typed release's
/// arrival, which is what the memory harness's LLVM column read before its
/// typed releases had a hook.
fn check_counts_agree(counts: &[Vec<u8>]) {
    let [c, counted, ordinary] = counts else {
        panic!("three reports, got {}", counts.len());
    };
    assert_eq!(String::from_utf8_lossy(c), String::from_utf8_lossy(counted));
    assert_ne!(
        String::from_utf8_lossy(counted),
        String::from_utf8_lossy(ordinary)
    );
}

/// An ordinary LLVM build carries no counting hook and no guard; a counting
/// build differs from it by exactly one arrival count per typed release, the
/// hook's declaration and the guard, and nothing else.
fn check_counting_hooks(ordinary: &str, counting: &str) {
    use nts_codegen_common::release::{ARRIVAL_COUNT, COUNTING_GUARD};
    let releases = ordinary
        .lines()
        .filter(|line| line.starts_with("define internal void @__nts_typed_release_"))
        .count();
    assert!(releases > 0, "no typed releases to count");
    assert!(!ordinary.contains(&format!("@{ARRIVAL_COUNT}")));
    assert!(!ordinary.contains(COUNTING_GUARD));
    let call = format!("  call void @{ARRIVAL_COUNT}()");
    let declaration = format!("declare void @{ARRIVAL_COUNT}()");
    let guard = format!("@{COUNTING_GUARD} = weak constant i8 1");
    let added: Vec<&str> = counting
        .lines()
        .filter(|line| *line == call || line.starts_with(&declaration) || *line == guard)
        .collect();
    assert_eq!(added.iter().filter(|line| **line == call).count(), releases);
    assert_eq!(added.len(), releases + 2, "{added:?}");
    let rest: Vec<&str> = counting
        .lines()
        .filter(|line| !added.contains(line))
        .collect();
    assert_eq!(rest, ordinary.lines().collect::<Vec<_>>());
}

/// `tooling/memory/harness.c` measures a program only if it was emitted for
/// counting: the C program under `NTS_COUNT_OPERATIONS`, the LLVM module
/// with `Counting::Operations`. An ordinary LLVM module stops it by name,
/// with status 2, instead of being measured short.
fn check_memory_harness(dir: &Utf8Path, sources: &[std::path::PathBuf]) {
    std::fs::write(
        dir.join("harness.c"),
        include_str!("../../../../tooling/memory/harness.c"),
    )
    .unwrap();
    let mut reports = Vec::new();
    for (input, status) in [
        ("graph.c", Some(0)),
        ("graph.ll", Some(0)),
        ("graph-uncounted.ll", Some(2)),
    ] {
        let binary = dir.join(format!("harness-{input}"));
        let built = Command::new("clang")
            .current_dir(dir)
            .args([
                "-std=c11",
                "-O1",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-override-module",
                "-I.",
                "-DNTS_PROVIDER_RC",
                "-DNTS_COUNT_OPERATIONS",
            ])
            .arg(input)
            .arg("harness.c")
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
        let ran = Command::new(&binary).output().unwrap();
        assert_eq!(ran.status.code(), status, "{input}: {ran:?}");
        if status == Some(2) {
            assert!(ran.stdout.is_empty(), "{input}: {ran:?}");
            assert!(
                String::from_utf8_lossy(&ran.stderr).contains(
                    "the program was not emitted for counting (nts_program_counts_operations"
                ),
                "{input}: {ran:?}"
            );
        } else {
            assert!(ran.stderr.is_empty(), "{input}: {ran:?}");
            reports.push(ran.stdout);
        }
    }
    let report = String::from_utf8_lossy(&reports[0]);
    assert!(report.contains(" leaked=0 "), "{report}");
    assert_eq!(report, String::from_utf8_lossy(&reports[1]));
}
