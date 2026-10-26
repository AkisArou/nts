//! Execute HRESULT output projections on a portable COM table. Failed outputs
//! contain a deliberately invalid address; interpreting, deleting or freeing it
//! terminates the test. `S_OK`/`S_FALSE` controls return real data through the same
//! slots. The string/array projections are the actual `nts_winrt.c` bodies.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;
use std::process::Command;

struct Case {
    name: &'static str,
    result: &'static str,
    read: &'static str,
    slots: &'static str,
    write: &'static str,
    answer: u32,
}

const CASES: &[Case] = &[
    Case {
        name: "reference",
        result: "boolean | null",
        read: "value === null ? 2 : value ? 1 : 0",
        slots: "void **out",
        write: "*out = mode < 2 ? (void *)1 : NULL;",
        answer: 2,
    },
    Case {
        name: "boxed",
        result: "Inspectable",
        read: "value === null ? 1 : 0",
        slots: "void **out",
        write: "*out = mode < 2 ? (void *)1 : NULL;",
        answer: 1,
    },
    Case {
        name: "handles",
        result: "(Result | null)[]",
        read: "value.length",
        slots: "uint32_t *count, void ***out",
        write: "*count = 2; *out = mode < 2 ? (void **)1 : calloc(2, sizeof(void *));",
        answer: 2,
    },
    Case {
        name: "record",
        result: "ByValue<PlainRecord>",
        read: "value.scalar",
        slots: "struct FailurePlain *out",
        write: "double value = 27; memcpy(out, &value, sizeof value);",
        answer: 27,
    },
    Case {
        name: "scalar",
        result: "Float64",
        read: "value",
        slots: "double *out",
        write: "*out = 27;",
        answer: 27,
    },
    Case {
        name: "boolean",
        result: "boolean",
        read: "value ? 1 : 0",
        slots: "uint8_t *out",
        write: "*out = 1;",
        answer: 1,
    },
    Case {
        name: "hstring",
        result: "HString",
        read: "value.length",
        slots: "void **out",
        write: "*out = mode < 2 ? (void *)1 : &text_cookie;",
        answer: 3,
    },
    Case {
        name: "numbers",
        result: "Float64Array",
        read: "value[0] + value[1]",
        slots: "uint32_t *count, double **out",
        write: "*count = 2; *out = mode < 2 ? (double *)1 : malloc(2 * sizeof(double)); if (mode >= 2) { (*out)[0] = 10; (*out)[1] = 20; }",
        answer: 30,
    },
    Case {
        name: "booleans",
        result: "boolean[]",
        read: "value.length + (value[0] ? 1 : 0)",
        slots: "uint32_t *count, uint8_t **out",
        write: "*count = 2; *out = mode < 2 ? (uint8_t *)1 : malloc(2); if (mode >= 2) { (*out)[0] = 1; (*out)[1] = 0; }",
        answer: 3,
    },
    Case {
        name: "strings",
        result: "string[]",
        read: "value[0].length + value[1].length",
        slots: "uint32_t *count, void ***out",
        write: "*count = 2; *out = mode < 2 ? (void **)1 : malloc(2 * sizeof(void *)); if (mode >= 2) { (*out)[0] = &text_cookie; (*out)[1] = &text_cookie; }",
        answer: 6,
    },
    Case {
        name: "copied",
        result: "Copied<Record>",
        read: "value.text.length + value.scalar",
        slots: "struct FailureRecord *out",
        write: "struct { void *text; double scalar; } value = { mode < 2 ? (void *)1 : &text_cookie, 27 }; memcpy(out, &value, sizeof value);",
        answer: 30,
    },
];

const HOST: &str = r#"
#include "nts_runtime.h"
#include <stdint.h>
NtsString *nts_string_from_hstring(void *);
NtsView *nts_winrt_received(void *, uint32_t, double);
NtsArray *nts_winrt_received_strings(void *, uint32_t);
void nts_winrt_free(void *);
void nts_winrt_received_handles(NtsArray *, void *, uint32_t);
NtsValue nts_winrt_unbox(void *);
void nts_com_release(void *);
void *nts_com_addref(void *);
char *nts_hresult_message(int32_t);
"#;

const NATIVE: &str = r#"
#include "program.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef uint32_t UINT32;
typedef void *HSTRING;
static int text_cookie, reads, deletes, frees;
static const wchar_t *WindowsGetStringRawBuffer(HSTRING h, UINT32 *length) {
  assert(h == NULL || h == &text_cookie);
  static const uint16_t units[] = {'a', 'b', 'c'};
  *length = h ? 3 : 0;
  if (h) ++reads;
  return (const wchar_t *)units;
}
static void WindowsDeleteString(HSTRING h) {
  assert(h == NULL || h == &text_cookie);
  if (h) ++deletes;
}
static void CoTaskMemFree(void *block) {
  assert(block != (void *)1);
  if (block) ++frees;
  free(block);
}
/* These cases deliberately use null successful references; touching a failed
 * non-null reference at either projection/ownership boundary must fail. The
 * non-null successful ownership control is in com_failure.rs. */
void nts_com_release(void *object) { assert(object == NULL); }
void *nts_com_addref(void *object) { assert(object == NULL); return object; }
NtsValue nts_winrt_unbox(void *object) {
  assert(object == NULL);
  return nts_value_of_null();
}
char *nts_hresult_message(int32_t status) {
  (void)status;
  char *message = malloc(8);
  memcpy(message, "failure", 8);
  return message;
}
/*ACTUAL_HELPERS*/
typedef struct {
  void *unknown[3];
  int32_t (*read)(void *, int32_t, /*SLOTS*/);
} Table;
static int32_t read_output(void *self, int32_t mode, /*SLOTS*/) {
  (void)self;
  /*WRITE*/
  return mode < 2 ? (int32_t)UINT32_C(0x80004005) : mode - 2;
}
static const Table table = {{NULL, NULL, NULL}, read_output};
int main(int argc, char **argv) {
  assert(argc == 2);
  struct { const Table *table; } receiver = { &table };
  double result = run((void *)&receiver, (int32_t)atoi(argv[1]));
  printf("%.0f reads=%d deletes=%d frees=%d\n", result, reads, deletes, frees);
  return 0;
}
"#;

fn actual_helpers() -> String {
    let source = include_str!("../../../../runtime/c/nts_winrt.c");
    let mut helpers = String::new();
    for signature in [
        "NtsString *nts_string_from_hstring(",
        "NtsView *nts_winrt_received(",
        "NtsArray *nts_winrt_received_strings(",
        "void nts_winrt_received_handles(",
        "void nts_winrt_free(",
    ] {
        let start = source.find(signature).unwrap();
        let body = start + source[start..].find('{').unwrap();
        let mut depth = 0;
        let end = source[body..]
            .char_indices()
            .find_map(|(at, ch)| {
                match ch {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
                (depth == 0).then_some(body + at + 1)
            })
            .unwrap();
        helpers.push_str(&source[start..end]);
        helpers.push('\n');
    }
    helpers
}

fn build(case: &Case, provider: hir::Provider) -> ScratchDir {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(
        &root.join("target/com-output-tests"),
        &format!("{}-{provider:?}", case.name),
    );
    let binding = format!(
        r#"declare module "winrt:OutputProbe" {{
  import type {{ ByValue, Struct }} from "c:types";
  import type {{ c_int, Float64 }} from "@nts/scalars";
  import type {{ ComClass, Copied, HString, Inspectable }} from "winrt:types";
  export type Record = Struct<{{ text: HString; scalar: Float64 }}, "FailureRecord">;
  export type PlainRecord = Struct<{{ scalar: Float64 }}, "FailurePlain">;
  export type Result = ComClass<"OutputResult">;
  export interface Methods {{
    /**
     * @ntsVtable 3 Read
     * @ntsHresult
     */
    Read(this: Probe, mode: c_int): {};
  }}
  export type Probe = ComClass<"OutputProbe"> & Methods;
}}"#,
        case.result
    );
    let program = format!(
        r#"import type {{ Probe }} from "winrt:OutputProbe";
import type {{ c_int, Float64 }} from "@nts/scalars";
export function run(probe: Probe, mode: c_int): Float64 {{
  try {{ const value = probe.Read(mode); return ({}); }}
  catch {{ return 7; }}
}}"#,
        case.read
    );
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), program).unwrap();
    std::fs::write(dir.join("tsconfig.json"), format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/winrt/winrt.d.ts"]}}"#)).unwrap();
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
    let native = NATIVE
        .replace("/*ACTUAL_HELPERS*/", &actual_helpers())
        .replace("/*SLOTS*/", case.slots)
        .replace("/*WRITE*/", case.write);
    std::fs::write(dir.join("native.c"), native).unwrap();
    std::fs::write(dir.join("com-host.h"), HOST).unwrap();
    let mut command = Command::new("clang");
    command.current_dir(&dir).args([
        "-std=gnu11",
        "-O2",
        "-include",
        "com-host.h",
        "program.c",
        "native.c",
        "nts_runtime.c",
        "-lm",
        "-lpthread",
        "-o",
        "caller",
    ]);
    if provider == hir::Provider::ReferenceCounting {
        command.arg("-DNTS_PROVIDER_RC");
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{} {provider:?}: {}",
        case.name,
        String::from_utf8_lossy(&output.stderr)
    );
    dir
}

#[test]
fn failed_outputs_are_not_interpreted_and_successful_outputs_are_preserved() {
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        for case in CASES {
            let dir = build(case, provider);
            for mode in [1, 2, 3] {
                let output = Command::new(dir.join("caller"))
                    .arg(mode.to_string())
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{} {provider:?} mode {mode}: {output:?}",
                    case.name
                );
                let text = String::from_utf8(output.stdout).unwrap();
                let expected = if mode == 1 { 7 } else { case.answer };
                assert!(
                    text.starts_with(&format!("{expected} ")),
                    "{} {provider:?} mode {mode}: {text}",
                    case.name
                );
                if mode == 1 {
                    assert!(text.ends_with("reads=0 deletes=0 frees=0\n"), "{text}");
                }
                eprintln!("{} {provider:?} mode {mode}: {text}", case.name);
            }
        }
    }
}
