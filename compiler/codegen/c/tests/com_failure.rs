//! A failed COM call grants no ownership of its output. The canary makes an
//! incorrect take/AddRef/Release observable without invalid memory. Successful
//! `S_OK`/`S_FALSE` controls must still adopt and release their returned object.
//!
//! Unproven hypothesis: windows-winrt's async nogc C teardown access violation
//! followed `again=HRESULT 0x80000018` and `missing=HRESULT 0x80070002`. An output
//! taken on failure might later be touched at teardown. This fixture shows a
//! take on nogc, but no canary AddRef/Release/value call; it does not attribute
//! that crash. After fixing the defect, first check that preserved async case.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;
use std::process::Command;

const BINDING: &str = r#"
declare module "winrt:FailureProbe" {
  import type { c_int } from "@nts/scalars";
  import type { ComClass } from "winrt:types";
  export interface ProbeMethods {
    /**
     * @ntsVtable 3 Fail
     * @ntsHresult
     */
    Fail(this: Probe, poison: c_int): Result | null;
  }
  export interface ResultMethods {
    /** @ntsVtable 3 Value */
    Value(this: Result): c_int;
  }
  export type Probe = ComClass<"Probe"> & ProbeMethods;
  export type Result = ComClass<"Result"> & ResultMethods;
}
"#;

const PROGRAM: &str = r#"
import type { Probe } from "winrt:FailureProbe";
import type { c_int } from "@nts/scalars";
export function run(probe: Probe, poison: c_int): c_int {
  try {
    const value = probe.Fail(poison);
    return value === null ? 0 as c_int : value.Value();
  } catch {
    return 7 as c_int;
  }
}
"#;

// The borrowed receiver and the poison output have separate counters. The only
// difference between the two runs is Fail's output value: NULL or the canary.
// The Win32-specific HRESULT text formatter is irrelevant to the lifetime test;
// its host stand-in still returns malloc-owned text as the real formatter does.
const NATIVE: &str = r#"
#include "program.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
typedef struct Probe Probe;
typedef struct {
  int32_t (*query)(void *, const void *, void **);
  uint32_t (*addref)(void *);
  uint32_t (*release)(void *);
  int32_t (*fail)(void *, int32_t, void **);
} Table;
struct Probe { const void *table; int poison; };
static int receiver_addrefs, receiver_releases, poison_addrefs, poison_releases;
static int takes, poison_takes, value_calls, fail_calls;
static uint32_t addref(void *object) {
  if (((Probe *)object)->poison) ++poison_addrefs; else ++receiver_addrefs;
  return 1;
}
static uint32_t release(void *object) {
  if (((Probe *)object)->poison) ++poison_releases; else ++receiver_releases;
  return 1;
}
static Probe canary;
static int32_t fail(void *self, int32_t poison, void **output) {
  (void)self;
  ++fail_calls;
  *output = poison ? &canary : NULL;
  return poison < 2 ? (int32_t)UINT32_C(0x80004005) : poison - 2;
}
static const Table table = { NULL, addref, release, fail };
static int32_t value(void *self) { (void)self; ++value_calls; return 13; }
static const struct {
  int32_t (*query)(void *, const void *, void **);
  uint32_t (*addref)(void *);
  uint32_t (*release)(void *);
  int32_t (*value)(void *);
} result_table = { NULL, addref, release, value };
static Probe canary = { &result_table, 1 };
void *__real_nts_com_take(void *slot);
void *__wrap_nts_com_take(void *slot) {
  void *value = __real_nts_com_take(slot);
  ++takes;
  if (value == &canary) ++poison_takes;
  return value;
}
char *nts_hresult_message(int32_t status) {
  char *message = malloc(32);
  if (!message) abort();
  snprintf(message, 32, "HRESULT 0x%08x", (unsigned)(uint32_t)status);
  return message;
}
int main(int argc, char **argv) {
  Probe receiver = { &table, 0 };
  int poison = argc > 1 ? atoi(argv[1]) : 0;
  int result = run(&receiver, poison);
  printf("result=%d takes=%d poison-takes=%d poison-addrefs=%d poison-releases=%d "
         "receiver-addrefs=%d receiver-releases=%d value-calls=%d fail-calls=%d\n",
         result, takes, poison_takes, poison_addrefs, poison_releases,
         receiver_addrefs, receiver_releases, value_calls, fail_calls);
  return 0;
}
"#;

/// Link the real portable COM helper bodies, not a substitute implementation of
/// adoption or counting. Only the Windows typedefs/calling-convention spelling
/// are supplied by the host. --wrap observes takes without changing the helper.
fn com_helpers() -> String {
    let source = include_str!("../../../../runtime/c/nts_winrt.c");
    let table_start = source
        .find("typedef struct {\n  HRESULT(STDMETHODCALLTYPE *query_interface)")
        .unwrap();
    let table_end = source[table_start..].find("} NtsUnknownTable;").unwrap()
        + table_start
        + "} NtsUnknownTable;".len();
    let mut text = String::from(
        "#include <stdint.h>\ntypedef int32_t HRESULT;\ntypedef uint32_t ULONG;\n\
         typedef struct { uint8_t bytes[16]; } IID;\n#define STDMETHODCALLTYPE\n\
         static uint32_t releases;\n",
    );
    text.push_str(&source[table_start..table_end]);
    for signature in [
        "void *nts_com_take(",
        "void *nts_com_addref(",
        "static void nts_unknown_release(",
        "void nts_com_unlend(",
        "void nts_com_release(",
    ] {
        let start = source.find(signature).unwrap();
        let body = start + source[start..].find('{').unwrap();
        let mut depth = 0;
        let end = source[body..]
            .char_indices()
            .find_map(|(i, ch)| {
                match ch {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
                (depth == 0).then_some(body + i + 1)
            })
            .unwrap();
        text.push('\n');
        text.push_str(&source[start..end]);
    }
    text
}

fn build(provider: hir::Memory) -> ScratchDir {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(
        &root.join("target/com-failure-tests"),
        &format!("{provider:?}"),
    );
    std::fs::write(dir.join("main.ts"), PROGRAM).unwrap();
    std::fs::write(dir.join("binding.d.ts"), BINDING).unwrap();
    std::fs::write(dir.join("tsconfig.json"), format!(
        r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/winrt/winrt.d.ts"]}}"#
    )).unwrap();
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
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("native.c"), NATIVE).unwrap();
    std::fs::write(dir.join("com-helpers.c"), com_helpers()).unwrap();
    // The runtime header exposes these only on Windows. The host fixture links
    // the actual helper bodies separately, so provide their same declarations.
    std::fs::write(
        dir.join("com-host.h"),
        "#include <stdint.h>\n\
        void *nts_com_take(void *);\nvoid *nts_com_addref(void *);\n\
        void nts_com_release(void *);\nvoid nts_com_unlend(const void *);\n\
        char *nts_hresult_message(int32_t);\n",
    )
    .unwrap();
    let mut command = Command::new("clang");
    command.current_dir(&dir).args([
        "-std=gnu11",
        "-D_GNU_SOURCE",
        "-O2",
        "-include",
        "com-host.h",
        "program.c",
        "nts_runtime.c",
        "com-helpers.c",
        "native.c",
        "-Wl,--wrap=nts_com_take",
        "-lm",
        "-lpthread",
        "-o",
        "caller",
    ]);
    if provider == hir::Memory::ReferenceCounting {
        command.arg("-DNTS_PROVIDER_RC");
    }
    let compiled = command.output().unwrap();
    assert!(
        compiled.status.success(),
        "{provider:?}: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    dir
}

#[test]
fn only_successful_hresult_outputs_are_taken_and_released() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let dir = build(provider);
        for mode in 0..4 {
            let output = Command::new(dir.join("caller"))
                .arg(mode.to_string())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{provider:?} mode={mode}: {output:?}"
            );
            let text = String::from_utf8(output.stdout).unwrap();
            eprintln!("{provider:?} mode={mode}: {text}");
            let counters: std::collections::BTreeMap<_, _> = text
                .split_ascii_whitespace()
                .map(|field| {
                    let (name, value) = field.split_once('=').unwrap();
                    (name, value.parse::<u32>().unwrap())
                })
                .collect();
            let success = mode >= 2;
            assert_eq!(counters["result"], if success { 13 } else { 7 }, "{text}");
            assert_eq!(counters["fail-calls"], 1, "{text}");
            for name in ["receiver-addrefs", "receiver-releases", "poison-addrefs"] {
                assert_eq!(counters[name], 0, "{name}: {text}");
            }
            assert_eq!(counters["takes"], 1, "{text}");
            assert_eq!(counters["poison-takes"], u32::from(success), "{text}");
            assert_eq!(counters["value-calls"], u32::from(success), "{text}");
            assert_eq!(
                counters["poison-releases"],
                u32::from(success && provider == hir::Memory::ReferenceCounting),
                "{text}"
            );
        }
    }
}
