//! Native ABI agreement against a separately compiled C implementation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::{fmt::Write, process::Command};

#[path = "../../common/test-support/native_cases.rs"]
mod native_cases;
use native_cases::CASES;

fn prepare(name: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    prepare_with_provider(name, source, hir::Provider::NoGc)
}

fn prepare_with_provider(name: &str, source: &str, provider: hir::Provider) -> Option<(Utf8PathBuf, hir::Prepared)> {
    prepare_with_files(name, source, provider, &[])
}

fn prepare_with_files(name: &str, source: &str, provider: hir::Provider, declarations: &[(&str, &str)]) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!(
        "target/native-llvm-tests/{}-{name}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let mut files = String::new();
    for (name, contents) in declarations {
        std::fs::write(dir.join(name), contents).unwrap();
        write!(files, ",\"{name}\"").unwrap();
    }
    std::fs::write(dir.join("tsconfig.json"), format!(
        r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"{files}]}}"#
    )).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare_with(&snapshot, &hir::Options { provider, ..hir::Options::default() }).unwrap()))
}

fn clang(dir: &Utf8Path, args: &[&str]) {
    let result = Command::new("clang")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn managed_declarations_execute_with_the_nts_abi_on_c_and_llvm() {
    let Some((dir, prepared)) = prepare(
        "managed-abi",
        include_str!("../../common/test-support/managed-abi/main.ts"),
    ) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(
        dir.join("native.h"),
        include_str!("../../common/test-support/managed-abi/native.h"),
    )
    .unwrap();
    std::fs::write(dir.join("native.c"), include_str!("../../common/test-support/managed-abi/native.c")).unwrap();
    std::fs::write(
        dir.join("caller.c"),
        include_str!("../../common/test-support/managed-abi/caller.c"),
    )
    .unwrap();
    for source in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(
            &dir,
            &[
                "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source,
            ],
        );
    }
    for (source, object, binary) in [
        ("program.c", "c.o", "c-run"),
        ("program.ll", "llvm.o", "llvm-run"),
    ] {
        clang(
            &dir,
            &[
                "-O2",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-override-module",
                "-c",
                source,
                "-o",
                object,
            ],
        );
        clang(
            &dir,
            &[
                object,
                "native.o",
                "caller.o",
                "nts_runtime.o",
                "-lm",
                "-o",
                binary,
            ],
        );
        assert!(
            Command::new(dir.join(binary)).status().unwrap().success(),
            "{binary}"
        );
    }
    // One authored parameter changed, implementation unchanged. The generated
    // prototype must disagree with the separately maintained native header.
    let wrong = c.writer.text().replace(
        "NtsValue bridge_value(NtsValue);",
        "NtsValue bridge_value(double);",
    );
    assert_ne!(wrong, c.writer.text());
    std::fs::write(dir.join("wrong.c"), wrong).unwrap();
    let result = Command::new("clang")
        .current_dir(&dir)
        .args(["-include", "native.h", "-fsyntax-only", "wrong.c"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("conflicting types"));
    // The unmodified generated declaration must agree with the same header.
    clang(
        &dir,
        &["-include", "native.h", "-fsyntax-only", "program.c"],
    );
}

#[test]
fn aggregate_arguments_respect_register_exhaustion() {
    let mut ts = String::new();
    let mut c = "#include \"nts_runtime.h\"\n".to_owned();
    let mut caller = "#include \"program.h\"\nint main(void) {\n".to_owned();
    for count in 0..8 {
        let (mut ts_params, mut c_params, mut ignore) = (String::new(), String::new(), String::new());
        for i in 0..count {
            write!(ts_params, "p{i}: string, ").unwrap();
            write!(c_params, "NtsString *p{i}, ").unwrap();
            write!(ignore, "(void)p{i}; ").unwrap();
        }
        let arguments = "\"x\", ".repeat(count);
        writeln!(ts, "/** @ntsAbi managed */
            declare function tagged_{count}({ts_params}v: unknown, tail: string): number;
            /** @ntsAbi managed */
            declare function wide_{count}({ts_params}v: bigint, tail: string): bigint;
            export function run_{count}(n: number): number {{
                if (wide_{count}({arguments}-18446744073709551619n, \"end\") !== -18446744073709551616n) return -1;
                return tagged_{count}({arguments}n, \"end\");
            }}").unwrap();
        writeln!(c, "double tagged_{count}({c_params}NtsValue v, NtsString *tail) {{ {ignore}return v.as.number + tail->length; }}
            __int128 wide_{count}({c_params}__int128 v, NtsString *tail) {{ {ignore}return v + tail->length; }}").unwrap();
        writeln!(caller, "if (run_{count}(3.75) != 6.75) return {};", count + 1).unwrap();
    }
    caller.push_str("return 0; }\n");
    let Some((dir, prepared)) = prepare("aggregate-registers", &ts) else { return };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c_program = nts_codegen_c::emit(&prepared.program);
    assert!(c_program.is_complete(), "{:?}", c_program.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("ptr byval({ i32, i64 }) align 8"));
    for file in c_program.support_files() { file.write(dir.as_std_path()).unwrap(); }
    for (file, source) in [("native.c", c), ("caller.c", caller), ("program.c", c_program.writer.text().to_owned()), ("program.ll", llvm.text)] {
        std::fs::write(dir.join(file), source).unwrap();
    }
    for source in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
    }
    for (source, binary) in [("program.c", "c-run"), ("program.ll", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", source, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", binary]);
        assert!(Command::new(dir.join(binary)).status().unwrap().success(), "{binary}");
    }
}

#[test]
fn intrinsic_annotations_do_not_authorize_arbitrary_foreign_symbols() {
    let Some((_, prepared)) = prepare("unknown-intrinsic", r"
        /** @ntsAbi intrinsic */
        declare function abs(n: number): number;
        export function run(n: number): number { return abs(n); }
    ") else { return };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(!c.is_complete());
    assert!(c.diagnostics.iter().any(|d| d.message.contains("abs") && d.message.contains("no declared C ABI")));
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.iter().any(|d| d.message.contains("abs")));
}

#[test]
fn managed_runtime_declarations_must_agree_with_the_header() {
    for (label, signature, call, valid) in [
        ("valid", "(): void", "nts_checkpoint(); return n", true),
        (
            "parameter",
            "(n: number): void",
            "nts_checkpoint(n); return n",
            false,
        ),
        ("result", "(): number", "return nts_checkpoint() + n", false),
    ] {
        let source = format!(
            "/** @ntsAbi managed */\ndeclare function nts_checkpoint{signature};\nexport function run(n: number): number {{ {call}; }}"
        );
        let Some((dir, prepared)) = prepare(&format!("runtime-abi-{label}"), &source) else {
            return;
        };
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        if valid {
            assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
            assert_eq!(
                llvm.text.matches("declare void @nts_checkpoint(").count(),
                1
            );
        } else {
            assert!(llvm.text.is_empty());
            assert!(
                llvm.diagnostics
                    .iter()
                    .any(|d| d.message.contains("disagrees with the runtime header ABI"))
            );
        }
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        let result = Command::new("clang")
            .current_dir(&dir)
            .args(["-fsyntax-only", "program.c"])
            .output()
            .unwrap();
        assert_eq!(
            result.status.success(),
            valid,
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        if !valid {
            assert!(String::from_utf8_lossy(&result.stderr).contains("conflicting types"));
        }
    }
}

#[test]
fn every_scalar_and_libm_cross_the_real_c_abi() {
    let brands = CASES
        .iter()
        .map(|case| case.0)
        .collect::<Vec<_>>()
        .join(", ");
    let mut ts = format!("import type {{ {brands} }} from \"c:types\";\n");
    let mut header = "#include <stdint.h>\n#include <stddef.h>\n#include <stdbool.h>\n".to_owned();
    let mut implementation = "#include \"native.h\"\n".to_owned();
    let mut prototypes = String::new();
    let mut caller = "int main(void) {\n".to_owned();
    for (i, (brand, c_type, input, expected)) in CASES.iter().enumerate() {
        writeln!(
            ts,
            "declare function take_{i}(v: {brand}): c_double;
            declare function give_{i}(): {brand};
            export function argument_{i}(v: number): number {{ return take_{i}(v as {brand}); }}
            export function result_{i}(): number {{ return give_{i}(); }}"
        )
        .unwrap();
        writeln!(
            header,
            "double take_{i}({c_type});\n{c_type} give_{i}(void);"
        )
        .unwrap();
        writeln!(
            implementation,
            "double take_{i}({c_type} v) {{ return v; }}
            {c_type} give_{i}(void) {{ return ({c_type})({input}); }}"
        )
        .unwrap();
        writeln!(
            prototypes,
            "double argument_{i}(double);\ndouble result_{i}(void);"
        )
        .unwrap();
        writeln!(
            caller,
            "if (argument_{i}({input}) != {expected} || result_{i}() != {expected}) return {};",
            i + 1
        )
        .unwrap();
    }
    ts.push_str("import { abs } from \"c:stdlib\"; import * as math from \"c:math\";
        declare function native_not(v: boolean): boolean;
        export function library(n: number): number { return abs(n as c_int) + math.sqrt(4 as c_double); }
        export function toggle(v: boolean): boolean { return native_not(v); }");
    header.push_str("bool native_not(bool);\n");
    implementation.push_str("bool native_not(bool v) { return !v; }\n");
    prototypes.push_str("double library(double);\n_Bool toggle(_Bool);\n");
    caller
        .push_str("if (library(-3.75) != 5 || toggle(1) || !toggle(0)) return 99;\nreturn 0; }\n");
    let Some((dir, prepared)) = prepare("scalar-abi", &ts) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_llvm::emit(&prepared.program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    assert!(emitted.text.contains("declare double @sqrt(double)"));
    assert!(
        emitted
            .text
            .contains("declare zeroext i1 @native_not(i1 zeroext)")
    );
    for (file, contents) in [
        ("native.h", header),
        ("native.c", implementation),
        ("caller.c", prototypes + &caller),
        ("program.ll", emitted.text.clone()),
    ] {
        std::fs::write(dir.join(file), contents).unwrap();
    }
    for file in ["native.c", "caller.c"] {
        clang(
            &dir,
            &[
                "-std=c11",
                "-O2",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-fno-builtin",
                "-c",
                file,
            ],
        );
    }
    clang(&dir, &["-O2", "-c", "program.ll", "-o", "program.o"]);
    clang(
        &dir,
        &["program.o", "native.o", "caller.o", "-lm", "-o", "caller"],
    );
    assert!(Command::new(dir.join("caller")).status().unwrap().success());

    assert_clang_abi(&dir, &emitted.text);
    assert_unsigned_return_control(&dir, &emitted.text);
}

fn assert_clang_abi(dir: &Utf8Path, ir: &str) {
    // Execution on x86 alone can pass without extension attributes. Ask clang
    // for the independent callee's ABI, including signed/unsigned narrow slots.
    clang(
        dir,
        &["-S", "-emit-llvm", "-O0", "native.c", "-o", "native.ll"],
    );
    let reference = std::fs::read_to_string(dir.join("native.ll")).unwrap();
    let names = (0..CASES.len())
        .flat_map(|i| [format!("take_{i}"), format!("give_{i}")])
        .chain(std::iter::once("native_not".to_owned()));
    for name in names {
        let pattern = format!("@{name}(");
        let expected = reference
            .lines()
            .find(|line| line.starts_with("define ") && line.contains(&pattern))
            .unwrap();
        let actual = ir
            .lines()
            .find(|line| line.starts_with("declare ") && line.contains(&pattern))
            .unwrap();
        assert_eq!(
            abi_tokens(actual),
            abi_tokens(expected),
            "{name}: {actual}\n{expected}"
        );
    }
}

fn abi_tokens(line: &str) -> Vec<&str> {
    // Ignore optimization facts (noundef, local_unnamed_addr), parameter names,
    // and linkage: machine scalar types and extension attributes form the ABI.
    line.split(')')
        .next()
        .unwrap()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| {
            matches!(
                *word,
                "void"
                    | "float"
                    | "double"
                    | "i1"
                    | "i8"
                    | "i16"
                    | "i32"
                    | "i64"
                    | "signext"
                    | "zeroext"
            )
        })
        .collect()
}

fn assert_unsigned_return_control(dir: &Utf8Path, ir: &str) {
    // One changed conversion, with identical C callee and caller objects.
    // Treating UINT32_MAX as signed must be observable in the return arm.
    assert!(ir.contains("uitofp i32"));
    let bad = ir.replacen("uitofp i32", "sitofp i32", 1);
    std::fs::write(dir.join("bad.ll"), bad).unwrap();
    clang(dir, &["-O2", "-c", "bad.ll", "-o", "bad.o"]);
    clang(dir, &["bad.o", "native.o", "caller.o", "-lm", "-o", "bad"]);
    assert!(!Command::new(dir.join("bad")).status().unwrap().success());
}

#[test]
fn conflicting_abis_and_runtime_collisions_are_refused() {
    for (name, source, expected) in [
        ("overloads", "declare function foreign(v: c_int): c_int; declare function foreign(v: c_uint): c_uint;
            export function run(n: number): number { return foreign(n as c_int) + foreign(n as c_uint); }", "conflicting ABI"),
        ("runtime", "declare function nts_math_pow(v: c_int): c_int;
            export function run(n: number): number { return nts_math_pow(n as c_int); }", "collides"),
    ] {
        let source = format!("import type {{ c_int, c_uint }} from \"c:types\";\n{source}");
        let Some((_, prepared)) = prepare(name, &source) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let emitted = nts_codegen_llvm::emit(&prepared.program);
        assert!(emitted.diagnostics.iter().any(|d| d.message.contains(expected)), "{:?}", emitted.diagnostics);
        assert!(emitted.text.is_empty());
    }
}

#[test]
fn compatible_c_aliases_share_one_symbol_in_both_backends() {
    let source = "import type { c_int, c_int32 } from \"c:types\";
        declare function native_identity(v: c_int): c_int;
        declare function native_identity(v: c_int32): c_int32;
        export function run(n: number): number {
            return native_identity(n as c_int) + native_identity(n as c_int32) + 0.5;
        }";
    let Some((dir, prepared)) = prepare("compatible-aliases", source) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert_eq!(
        llvm.text
            .matches("declare i32 @native_identity(i32)")
            .count(),
        1
    );
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
    std::fs::write(
        dir.join("native.c"),
        "int native_identity(int n) { return n; }\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("caller.c"),
        "double run(double);\nint main(void) { return run(3.75) != 6.5; }\n",
    )
    .unwrap();
    clang(&dir, &["-O2", "-c", "native.c", "-o", "native.o"]);
    for source in ["program.c", "program.ll"] {
        clang(&dir, &["-O2", "-c", source, "-o", "program.o"]);
        clang(&dir, &["program.o", "native.o", "caller.c", "-o", "caller"]);
        assert!(Command::new(dir.join("caller")).status().unwrap().success());
    }
}

#[test]
fn opaque_handles_keep_pointer_bits_and_manual_lifetime_on_both_backends() {
    let source = r#"
import type { Opaque, c_int } from "c:types";
type Counter = Opaque<"Counter">;
type Wide = Opaque<"_Wide">;
declare function counter_new(n: c_int): Counter | null;
declare function counter_read(c: Counter): c_int;
declare function counter_bump(c: Counter, n: c_int): c_int;
declare function counter_destroy(c: Counter): void;
declare function wide_new(): Wide;
declare function wide_valid(w: Wide): boolean;
/** @ntsAbi managed */
declare function invoke(f: () => number): number;
export function run(n: number): number {
    const c = counter_new(n as c_int);
    if (c === null) return -1;
    counter_bump(c, 2 as c_int);
    const answer = invoke(() => counter_read(c));
    counter_destroy(c);
    return answer + 0.25;
}
export function wide(): boolean { return wide_valid(wide_new()); }
export function identity(c: Counter | null): Counter | null { return c; }
"#;
    for (label, provider) in [("nogc", hir::Provider::NoGc), ("rc", hir::Provider::ReferenceCounting)] {
        let Some((dir, prepared)) = prepare_with_provider(&format!("opaque-{label}"), source, provider) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        for func in &prepared.program.funcs {
            for op in &func.values {
                if let hir::OpKind::Retain(value) | hir::OpKind::Release(value) | hir::OpKind::Erase { value } = op.kind {
                    assert!(!matches!(func.values[value.0 as usize].ty, hir::HirType::NativePointer(_)));
                }
            }
        }
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        assert!(c.writer.text().contains("struct Counter *"));
        assert!(c.writer.text().contains("struct _Wide *"));
        assert!(llvm.text.contains("declare ptr @wide_new()"));
        assert!(!llvm.text.contains("ptrtoint"), "pointer bits must never travel through numbers");
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("counter.h"), include_str!("../../../../examples/interop/c-from-ts/native/counter.h")).unwrap();
        std::fs::write(dir.join("counter.c"), include_str!("../../../../examples/interop/c-from-ts/native/counter.c")).unwrap();
        std::fs::write(dir.join("native.c"), r#"
#include "nts_runtime.h"
#include "counter.h"
struct _Wide;
struct _Wide *wide_new(void) { return (struct _Wide *)(uintptr_t)UINT64_C(0x0020000000000001); }
bool wide_valid(struct _Wide *p) { return (uintptr_t)p == UINT64_C(0x0020000000000001); }
double invoke(NtsHeader *cb) {
    return ((double (*)(NtsHeader *))cb->descriptor->methods[nts_closure_call_slot])(cb);
}
"#).unwrap();
        std::fs::write(dir.join("caller.c"), r#"
#include "program.h"
#include "counter.h"
int main(void) {
    if (run(3.75) != 5.25 || run(-1) != -1 || counter_live() != 0) return 1;
    if (!wide()) return 2;
    Counter *c = counter_new(9);
    if (identity(c) != c || identity(NULL) != NULL) return 3;
    counter_destroy(c);
    return counter_live() != 0;
}
"#).unwrap();
        for file in ["counter.c", "native.c", "caller.c", "nts_runtime.c"] {
            clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
        }
        for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
            clang(&dir, &[object, "counter.o", "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
            assert!(Command::new(dir.join(executable)).status().unwrap().success(), "{label}/{executable}");
        }
    }
}

#[test]
fn scalar_pointer_memory_agrees_with_c_layout_and_aliasing() {
    let brands = CASES.iter().map(|case| case.0).collect::<Vec<_>>().join(", ");
    let mut source = format!("import type {{ Ptr, {brands} }} from \"c:types\";\n");
    let mut caller = "#include \"program.h\"\nint main(void) {\n".to_owned();
    for (i, (brand, ctype, input, expected)) in CASES.iter().enumerate() {
        writeln!(source, "export function memory_{i}(p: Ptr<{brand}>, q: Ptr<{brand}>, n: number): number {{
            p[1] = n;
            const before = q[1];
            let index = 1;
            p[index++] += 0;
            p[2] = 7;
            return before + q[index] + index;
        }}").unwrap();
        writeln!(caller, "{{ {ctype} data[4] = {{11, 0, 0, 23}};
            if (memory_{i}(data, data, {input}) != (double)({expected}) + 9) return {};
            if (data[0] != 11 || data[1] != ({ctype})({expected}) || data[2] != 7 || data[3] != 23) return {};
        }}", i * 2 + 1, i * 2 + 2).unwrap();
    }
    source.push_str("declare function mutate(p: Ptr<c_uint8>): void;
        export function acrossCall(p: Ptr<c_uint8>, alias: Ptr<c_uint8>): number {
            const before = alias[0]; mutate(p); return before * 100 + alias[0];
        }");
    // Compile the checked-in example as part of this same two-backend fixture.
    source.push_str(include_str!("../../../../examples/interop/native-buffer/src/main.ts")
        .split_once('\n').unwrap().1);
    caller.push_str("uint8_t shared = 2; if (acrossCall(&shared, &shared) != 295) return 40;\n");
    caller.push_str("uint8_t text[] = {'a', 0, 'z', 195, 'Q'};
        if (uppercaseAscii(text, 5) != 2 || text[0] != 'A' || text[1] != 0 || text[2] != 'Z' || text[3] != 195 || text[4] != 'Q') return 41;
        return 0; }\n");
    let Some((dir, prepared)) = prepare("pointer-memory", &source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(!llvm.text.contains("ptrtoint"));
    assert!(!c.writer.text().contains("nts_array_"));
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("caller.c"), caller).unwrap();
    std::fs::write(dir.join("native.h"), "#include <stdint.h>\nvoid mutate(uint8_t *p);\n").unwrap();
    std::fs::write(dir.join("native.c"), "#include \"native.h\"\nvoid mutate(uint8_t *p) { p[0] = 95; }\n").unwrap();
    clang(&dir, &["-O2", "-c", "native.c", "-o", "native.o"]);
    clang(&dir, &["-O2", "-c", "nts_runtime.c", "-o", "runtime.o"]);
    clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", "caller.c", "-o", "caller.o"]);
    for (input, output) in [("program.c", "c-program.o"), ("program.ll", "llvm-program.o")] {
        clang(&dir, &["-O2", "-c", input, "-o", output]);
        clang(&dir, &[output, "caller.o", "native.o", "runtime.o", "-lm", "-o", "caller"]);
        assert!(Command::new(dir.join("caller")).status().unwrap().success(), "{input}");
    }
}

#[test]
fn native_struct_fields_addresses_and_aliases_agree_with_c() {
    let source = include_str!("../../common/test-support/native-structs/main.ts");
    let Some((dir, prepared)) = prepare("native-structs", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), include_str!("../../common/test-support/native-structs/native.c")).unwrap();
    std::fs::write(dir.join("caller.c"), include_str!("../../common/test-support/native-structs/caller.c")).unwrap();
    for source in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
    }
    for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", "caller"]);
        assert!(Command::new(dir.join("caller")).status().unwrap().success(), "{source}");
    }
    // Corrupt only the address given to stamp: public layouts, C caller and
    // C implementation remain the identical objects used by the passing arm.
    let good = "getelementptr i8, ptr %v0, i64 16";
    assert!(llvm.text.contains(good));
    let bad = llvm.text.replacen(good, "getelementptr i8, ptr %v0, i64 20", 1);
    std::fs::write(dir.join("bad.ll"), bad).unwrap();
    clang(&dir, &["-O2", "-Wno-override-module", "-c", "bad.ll", "-o", "bad.o"]);
    clang(&dir, &["bad.o", "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", "bad"]);
    assert_eq!(Command::new(dir.join("bad")).status().unwrap().code(), Some(2));
}

#[test]
fn native_poll_calls_libc_and_matches_the_platform_header() {
    let source = include_str!("../../../../examples/interop/native-poll/src/main.ts");
    let declarations = [("poll.d.ts", include_str!("../../../../examples/interop/native-poll/types/poll.d.ts"))];
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((dir, prepared)) = prepare_with_files("native-poll", source, provider, &declarations) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("caller.c"), include_str!("../../../../examples/interop/native-poll/native/caller.c")).unwrap();
        std::fs::write(dir.join("layout.c"), include_str!("../../../../examples/interop/native-poll/native/layout.c")).unwrap();
        for source in ["caller.c", "layout.c", "nts_runtime.c"] {
            clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
        }
        for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
            clang(&dir, &[object, "caller.o", "layout.o", "nts_runtime.o", "-lm", "-o", "caller"]);
            assert!(Command::new(dir.join("caller")).status().unwrap().success(), "{source} {provider:?}");
        }
    }
}

#[test]
fn native_fd_reads_through_a_void_pointer_and_agrees_with_unistd() {
    let source = include_str!("../../../../examples/interop/native-fd/src/main.ts");
    let declarations = [(
        "unistd.d.ts",
        include_str!("../../../../examples/interop/native-fd/types/unistd.d.ts"),
    )];
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((dir, prepared)) = prepare_with_files("native-fd", source, provider, &declarations)
        else {
            return;
        };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(
            dir.join("caller.c"),
            include_str!("../../../../examples/interop/native-fd/native/caller.c"),
        )
        .unwrap();
        // The witness translation unit is the check: it includes the real
        // <unistd.h>, so `read`'s generated prototype has to agree with the
        // system one. It is compiled here rather than only in build.sh.
        std::fs::write(
            dir.join("witness.c"),
            include_str!("../../../../examples/interop/native-fd/native/witness.c"),
        )
        .unwrap();
        for source in ["caller.c", "witness.c", "nts_runtime.c"] {
            clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
        }
        for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
            clang(
                &dir,
                &[object, "caller.o", "witness.o", "nts_runtime.o", "-lm", "-o", "caller"],
            );
            assert!(
                Command::new(dir.join("caller")).status().unwrap().success(),
                "{source} {provider:?}"
            );
        }
    }
}

/// The control for the slice above: a buffer declared as a typed pointer rather
/// than `void *`.
///
/// It typechecks, it lowers without a diagnostic, and `program.c` compiles --
/// because `program.c` declares `read` itself and never sees <unistd.h>. Only
/// the witness, which does see it, can refuse. If this arm ever compiles, the
/// witness has stopped checking prototypes and the example above proves nothing.
#[test]
fn a_typed_buffer_where_read_wants_void_is_refused_by_the_witness() {
    let declarations = [(
        "unistd.d.ts",
        "declare module \"c:unistd\" {\n\
         import type { Ptr, c_int, c_size_t, c_ptrdiff_t, c_uint8 } from \"c:types\";\n\
         export type Fd = c_int;\n\
         export type Count = c_size_t;\n\
         /** @ntsNoEscape buf */\n\
         export function read(fd: Fd, buf: Ptr<c_uint8>, count: Count): c_ptrdiff_t;\n\
         }\n",
    )];
    let source = "import { read, type Fd, type Count } from \"c:unistd\";\n\
         import { local } from \"c:memory\";\n\
         import type { c_uint8 } from \"c:types\";\n\
         export function readCount(fd: number): number {\n\
         const buf = local<c_uint8>(8);\n\
         return read(fd as Fd, buf, 8 as Count);\n\
         }\n";
    let Some((dir, prepared)) =
        prepare_with_files("native-fd-typed", source, hir::Provider::NoGc, &declarations)
    else {
        return;
    };
    // The point of the control: lowering is happy with the wrong declaration.
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    let witness = dir.join("native_witness.h");
    assert!(
        witness.exists(),
        "a program calling a foreign function published no witness"
    );
    std::fs::write(
        dir.join("witness.c"),
        "#include <unistd.h>\n#include <stdint.h>\n#include <stddef.h>\n#include \"native_witness.h\"\n",
    )
    .unwrap();
    let refused = !Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-I"])
        .arg(&dir)
        .arg(dir.join("witness.c"))
        .status()
        .unwrap()
        .success();
    assert!(refused, "the real <unistd.h> accepted `read` with a uint8_t * buffer");
}

#[test]
fn native_struct_rejections_preserve_the_valid_arm() {
    for (name, bad) in [
        ("aggregate-store", "export function bad(p: Ptr<State>): void { p[0] = p[1]; }"),
        ("spread", "export function bad(p: Ptr<State>): number { const copy = {...p}; return copy.count; }"),
        ("managed-address", "export function bad(): number { const p = {count: 1}; return addrOf(p.count)[0]; }"),
        ("plain-field", "type Bad = Struct<{count: number}>; export function bad(p: Ptr<Bad>): number { return p.count; }"),
        ("optional-field", "type Bad = Struct<{count?: c_int32}>; export function bad(p: Ptr<Bad>): number { return p.count ?? 0; }"),
        ("nested-field", "type Bad = Struct<{inner: State}>; export function bad(p: Ptr<Bad>): void { void p; }"),
        ("schema-value", "export function bad(p: State): void { void p; }"),
        ("lying-address", "/** @ntsAbi intrinsic */ declare function addrOf(p: unknown): Ptr<c_double>; export function bad(p: Ptr<State>): number { return addrOf(p.count)[0]; }"),
    ] {
        // The managed-address case must reach lowering without a TS error;
        // a false intrinsic declaration cannot authorize addressing a TS object.
        let bad = if name == "managed-address" {
            "/** @ntsAbi intrinsic */ declare function addrOf(p: unknown): Ptr<c_int32>; export function bad(): number { const o = {count: 1}; return addrOf(o.count)[0]; }"
        } else { bad };
        let import = if matches!(name, "lying-address" | "managed-address") { "" } else { "import {addrOf} from 'c:memory';" };
        let source = format!("import type {{Ptr, Struct, c_int32, c_double}} from 'c:types'; {import}\n type State = Struct<{{count: c_int32}}>; export function good(p: Ptr<State>): number {{ return p.count; }} {bad}");
        let Some((_, prepared)) = prepare(name, &source) else { return; };
        assert!(!prepared.diagnostics.is_empty(), "{name} was accepted");
        assert!(prepared.program.funcs.iter().any(|f| f.name == "good"), "{name}: {:?}", prepared.diagnostics);
        assert!(!prepared.program.funcs.iter().any(|f| f.name == "bad"), "{name}: {:?}", prepared.diagnostics);
    }
}

#[test]
fn conflicting_native_struct_tags_refuse_in_both_backends() {
    let source = "import type {Ptr, Struct, c_int32, c_double} from 'c:types';
        type A = Struct<{x:c_int32}, 'Collision'>;
        type B = Struct<{x:c_double}, 'Collision'>;
        export function a(p:Ptr<A>):number {return p.x;}
        export function b(p:Ptr<B>):number {return p.x;}";
    let Some((_, prepared)) = prepare("struct-collision", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    for diagnostics in [&c.diagnostics, &llvm.diagnostics] {
        assert!(diagnostics.iter().any(|d| d.message.contains("conflicting native layouts")), "{diagnostics:?}");
    }
}

#[test]
fn native_address_verifier_rejects_wrong_field_type_and_index() {
    let source = "import type {Ptr, Struct, c_int32} from 'c:types';
        import {addrOf} from 'c:memory';
        type S = Struct<{x:c_int32}>;
        export function field(p:Ptr<S>):Ptr<c_int32> {return addrOf(p.x);}
        // An element of a block of structs is already an address, so this is
        // `p + i` and not `&(p + i)`; `addrOf` here would be a Ptr<Ptr<S>>.
        export function item(p:Ptr<S>, i:number):Ptr<S> {return p[i];}";
    let Some((_, prepared)) = prepare("verify-native-address", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    assert!(hir::verify::verify(&prepared.program).is_ok());
    for corruption in 0..3 {
        let mut program = prepared.program.clone();
        let mut changed = false;
        for func in &mut program.funcs {
            for value in &mut func.values {
                match &mut value.kind {
                    hir::OpKind::NativeFieldAddress { field, .. } if corruption < 2 => {
                        if corruption == 0 { *field = u32::MAX; } else { value.ty = hir::HirType::NUMBER; }
                        changed = true;
                    }
                    hir::OpKind::NativeIndexAddress { .. } if corruption == 2 => {
                        value.ty = hir::HirType::NUMBER;
                        changed = true;
                    }
                    _ => {}
                }
            }
        }
        assert!(changed);
        assert!(hir::verify::verify(&program).is_err(), "corruption {corruption}");
    }
}

#[test]
fn native_header_alias_survives_an_unrelated_layout_declaration() {
    let source = "import type {Ptr, Struct, c_int32} from 'c:types';
        import {addrOf as address} from 'c:memory';
        type State = Struct<{count:c_int32}>;
        function addrOf(n:number):number {return n+2;}
        export function inspectState(p:Ptr<State>):number {return addrOf(address(p.count)[0]);}";
    let caller = "#include \"program.h\"\nint main(void) {inspectState_p_t s={17}; return inspectState(&s)==19 ? 0 : 1;}\n";
    for (case, prefix) in [("alone", ""), ("perturbed", "type Unrelated = {first:number; second:string};\n")] {
        let Some((dir, prepared)) = prepare(case, &format!("{prefix}{source}")) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "program.c", "caller.c", "-o", "caller"]);
        assert!(Command::new(dir.join("caller")).status().unwrap().success());
    }
}

#[test]
fn native_owned_storage_executes_on_c_and_llvm() {
    let source = include_str!("../../common/test-support/native-storage/main.ts");
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((dir, prepared)) = prepare_with_provider("native-storage", source, provider) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("caller.c"), include_str!("../../common/test-support/native-storage/caller.c")).unwrap();
        std::fs::write(dir.join("native.c"), include_str!("../../common/test-support/native-storage/native.c")).unwrap();
        for file in ["caller.c", "native.c", "nts_runtime.c"] {
            clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
        }
        for (file, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-Wall", "-Wextra", "-Werror", "-c", file, "-o", object]);
            clang(&dir, &[object, "caller.o", "native.o", "nts_runtime.o", "-lm", "-Wl,--wrap=malloc", "-Wl,--wrap=free", "-o", "caller"]);
            let result = Command::new(dir.join("caller")).status().unwrap();
            assert!(result.success(), "{file} {provider:?}: {result}");
        }
        // The caller and allocator objects are unchanged: removing ONLY the
        // integer check must let heap(4.5) reach the allocator and fail.
        let bad = llvm.text.replacen("%valid = and i1 %range, %integral", "%valid = and i1 %range, true", 1);
        assert_ne!(bad, llvm.text);
        std::fs::write(dir.join("bad.ll"), bad).unwrap();
        clang(&dir, &["-O2", "-Wno-override-module", "-c", "bad.ll", "-o", "bad.o"]);
        clang(&dir, &["bad.o", "caller.o", "native.o", "nts_runtime.o", "-lm", "-Wl,--wrap=malloc", "-Wl,--wrap=free", "-o", "bad"]);
        assert_eq!(Command::new(dir.join("bad")).status().unwrap().code(), Some(2));
    }
}

#[test]
fn authored_allocator_symbols_cannot_redefine_storage_operations() {
    let source = r"
        import { malloc as allocate, free } from 'c:stdlib';
        import type { Ptr, c_int, c_size_t } from 'c:types';
        declare function malloc(bytes: c_size_t): Ptr<c_int> | null;
        export function run(): number {
            const a = allocate<c_int>(4);
            const b = malloc(4 as c_size_t);
            if (a !== null) free(a);
            if (b !== null) free(b);
            return 1;
        }
    ";
    let Some((_, prepared)) = prepare("allocator-collision", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    for diagnostics in [&c.diagnostics, &llvm.diagnostics] {
        assert!(diagnostics.iter().any(|d| d.message.contains("collides with the compiler's memory operations")), "{diagnostics:?}");
    }
}
