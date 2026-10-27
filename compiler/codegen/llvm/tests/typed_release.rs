//! Typed field cleanup must execute across the C/LLVM runtime boundary, under
//! both native providers; source-only assertions cannot check a callback ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = include_str!("../../../../tests/programs/typed-release-fields/src/main.ts");
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
extern double typedGraph(double);
extern double cycleGraph(double);
extern double deepGraph(double);
extern NtsHeader *ownedGraph(double);
extern size_t descriptorSize(void);
extern size_t releaseFieldsOffset(void);
int main(void) {
  if (descriptorSize() != sizeof(NtsDescriptor) ||
      releaseFieldsOffset() != offsetof(NtsDescriptor, release_fields)) return 2;
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
  /* The generic walk skips null slots before calling nts_release. The typed
   * callback must do so too: calls count even when the payload is null. */
  NtsHeader *empty = nts_object_new(descriptor);
  NtsValue *slot = (NtsValue *)((char *)empty + descriptor->erased_offsets[0]);
  *slot = nts_value_of_reference(NULL, NTS_TAG_OBJECT);
  nts_counting_reset();
  nts_release(empty);
  if (nts_counted_releases() != 1) return 5;
#endif
  for (int i = 0; i < 24; i++) {
    printf("%.0f %.0f %.0f\n", typedGraph(i), cycleGraph(i), deepGraph(i));
    nts_collect_cycles();
  }
#ifdef NTS_PROVIDER_RC
  if (nts_live_count() != 0 || nts_live_bytes() != 0) return 1;
#endif
  return 0;
}
"#;

const C_ABI_QUERY: &str = "\nsize_t descriptorSize(void) { return sizeof(NtsDescriptor); }\n\
    size_t releaseFieldsOffset(void) { return offsetof(NtsDescriptor, release_fields); }\n";
const LLVM_ABI_QUERY: &str = "\ndefine i64 @descriptorSize() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i64 1\n\
    %size = ptrtoint ptr %p to i64\n\
    ret i64 %size\n}\n\
    define i64 @releaseFieldsOffset() {\n\
    %p = getelementptr %NtsDescriptor, ptr null, i32 0, i32 14\n\
    %offset = ptrtoint ptr %p to i64\n\
    ret i64 %offset\n}\n";

fn run_native(
    dir: &Utf8Path,
    provider: hir::Provider,
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
    if provider == hir::Provider::ReferenceCounting {
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
    if expected_exit == 3 {
        assert_eq!(run.stderr, b"missing typed contents callback\n");
        eprintln!("{input}: NULL callback slots rejected at execution (exit 3)");
    } else {
        assert!(run.stderr.is_empty(), "{input}: {:?}", run.stderr);
    }
    run.stdout
}

/// Leave the definitions intact, but disconnect every descriptor. The C
/// conditional still references the function so -Wunused-function cannot
/// substitute for the executed descriptor guard this control must reach.
fn without_descriptor_callbacks(source: &str, llvm: bool) -> String {
    let mut changed = 0;
    let lines: Vec<String> = source
        .lines()
        .map(|line| {
            let (descriptor, marker) = if llvm {
                ("constant %NtsDescriptor", "ptr @nts_release_fields_")
            } else {
                ("static const NtsDescriptor", "nts_release_fields_")
            };
            if line.contains(descriptor)
                && let Some(start) = line.rfind(marker)
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
    for (input, source, is_llvm) in [("unwired.c", c, false), ("unwired.ll", llvm, true)] {
        let query = if is_llvm { LLVM_ABI_QUERY } else { C_ABI_QUERY };
        std::fs::write(
            dir.join(input),
            format!("{}{query}", without_descriptor_callbacks(source, is_llvm)),
        )
        .unwrap();
        run_native(dir, hir::Provider::ReferenceCounting, input, sources, 3);
    }
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
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
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
        assert!(c.writer.text().contains("static void nts_release_fields_"));
        assert!(
            llvm.text
                .contains("define internal void @nts_release_fields_")
        );
        // Foreign tags must not take the generated managed-edge path.
        assert!(!c.writer.text().contains("nts_value_release(slot_"));
        std::fs::write(
            dir.join("program.c"),
            format!("{}{C_ABI_QUERY}", c.writer.text()),
        )
        .unwrap();
        std::fs::write(
            dir.join("program.ll"),
            format!("{}{LLVM_ABI_QUERY}", llvm.text),
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
        if provider == hir::Provider::ReferenceCounting {
            cross_compile(&dir, &prepared.program);
            check_unwired(&dir, c.writer.text(), &llvm.text, &sources);
        }
    }
}
