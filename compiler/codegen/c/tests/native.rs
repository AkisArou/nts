//! Compile the foreign implementation separately against its own header. A
//! generated prototype agreeing with itself is not evidence of C ABI agreement.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::fmt::Write;
use std::process::Command;

fn prepare(name: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    prepare_with_types(name, source, true)
}

fn prepare_with_types(
    name: &str,
    source: &str,
    include_types: bool,
) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!(
        "target/native-c-tests/{}-{name}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    // Keep isolated-brand controls free of unrelated ambient declarations.
    let declarations = if include_types || source.contains("\"c:") {
        format!(",\"{root}/runtime/native/libc.d.ts\"")
    } else {
        String::new()
    };
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"{declarations}]}}"#
        ),
    )
    .unwrap();
    let imports = if include_types {
        "import type { c_int, c_uint, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_long, c_ulong, c_size_t, c_ptrdiff_t, c_float, c_double } from \"c:types\";\n"
    } else {
        ""
    };
    std::fs::write(dir.join("main.ts"), format!("{imports}{source}")).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

#[path = "../../common/test-support/native_cases.rs"]
mod native_cases;
use native_cases::CASES;

#[test]
fn scalar_abi_matches_an_independently_compiled_c_library() {
    let published = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/native/libc.d.ts"
    ));
    let published: std::collections::BTreeSet<_> = published
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("export type c_") && line.contains("unique symbol"))
        .map(|line| line.split_whitespace().nth(2).unwrap())
        .collect();
    assert_eq!(
        published,
        CASES.iter().map(|case| case.0).collect(),
        "each shipped scalar needs an independent C ABI case"
    );
    let mut ts = String::new();
    let mut header = "#include <stdint.h>\n#include <stddef.h>\n".to_owned();
    let mut implementation = "#include \"native.h\"\n".to_owned();
    let mut caller = "#include \"program.h\"\nint main(void) {\n".to_owned();
    for (i, (brand, c_type, input, expected)) in CASES.iter().enumerate() {
        write!(
            ts,
            "declare function take_{i}(n: {brand}): c_double;\n\
             declare function give_{i}(): {brand};\n\
             declare function give_wide_{i}(): {brand};\n\
             export function argument_{i}(n: number): number {{ return take_{i}(n as {brand}); }}\n\
             export function result_{i}(): number {{ return give_{i}() + 0.25; }}\n\
             export function wide_result_{i}(): number {{ return give_wide_{i}(); }}\n"
        )
        .unwrap();
        write!(
            header,
            "double take_{i}({c_type});\n{c_type} give_{i}(void);\n{c_type} give_wide_{i}(void);\n"
        )
        .unwrap();
        write!(
            implementation,
            "double take_{i}({c_type} n) {{ return n; }}\n{c_type} give_{i}(void) {{ return 7; }}\n\
             {c_type} give_wide_{i}(void) {{ return ({c_type})({input}); }}\n"
        )
        .unwrap();
        writeln!(
            caller,
            "if (argument_{i}({input}) != {expected} || result_{i}() != 7.25 || wide_result_{i}() != {expected}) return {};",
            i + 1
        )
        .unwrap();
    }
    caller.push_str("return 0; }\n");
    let Some((dir, prepared)) = prepare("scalar-abi", &ts) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let c = emitted.writer.text();
    assert!(c.contains("double take_0(int);"));
    std::fs::write(dir.join("program.c"), c).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    for (name, contents) in [
        ("native.h", header),
        ("native.c", implementation),
        ("caller.c", caller),
    ] {
        std::fs::write(dir.join(name), contents).unwrap();
    }
    // No LTO: a caller and callee with inconsistent prototypes must cross a
    // real ABI boundary rather than be optimized into one translation unit.
    for source in ["native.c", "program.c", "caller.c"] {
        let result = Command::new("clang")
            .current_dir(&dir)
            .args([
                "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source,
            ])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{source}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let result = Command::new("clang")
        .current_dir(&dir)
        .args(["native.o", "program.o", "caller.o", "-o", "caller"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(Command::new(dir.join("caller")).status().unwrap().success());

    assert_corrupted_abi_is_rejected(&prepared.program);
}

fn assert_corrupted_abi_is_rejected(program: &hir::Program) {
    // Reconciliation fixed operands/results before this single-row mutation.
    // Exercise every scalar and both positions, including unsigned byte/float.
    for i in 0..CASES.len() {
        for is_result in [false, true] {
            let mut corrupted = program.clone();
            let name = if is_result {
                format!("give_{i}")
            } else {
                format!("take_{i}")
            };
            let op = corrupted.funcs.iter_mut().flat_map(|f| &mut f.values).find(|op|
                matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. } if target.name == name)
            ).unwrap();
            let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &mut op.kind
            else {
                unreachable!()
            };
            let target = std::sync::Arc::make_mut(target);
            let ty = if is_result {
                &mut target.result
            } else {
                &mut target.parameters[0]
            };
            *ty = if *ty == hir::native::Type::Scalar(hir::native::Scalar::Double) {
                hir::native::Type::Scalar(hir::native::Scalar::Int)
            } else {
                hir::native::Type::Scalar(hir::native::Scalar::Double)
            };
            let problems = hir::verify::verify(&corrupted).unwrap_err();
            assert!(
                problems.iter().any(|p| match p {
                    hir::verify::Invalid::CallResultType { callee, .. } if is_result =>
                        callee == &name,
                    hir::verify::Invalid::CallArgumentType { callee, .. } if !is_result =>
                        callee == &name,
                    _ => false,
                }),
                "{name}: {problems:?}"
            );
        }
    }
}

#[test]
fn unbranded_parameter_and_return_are_separate_refusals() {
    for (name, declaration, call, expected) in [
        (
            "parameter",
            "declare function bad(n: number): c_int;",
            "bad(n)",
            "parameter `n` without a native ABI type",
        ),
        (
            "return",
            "declare function bad(n: c_int): number;",
            "bad(n as c_int)",
            "return without a native ABI type",
        ),
    ] {
        for unrelated in ["", "declare function witness(n: c_int): c_int;"] {
            let source = format!(
                "{declaration}\n{unrelated}\nexport function run(n: number): number {{ return {call}; }}"
            );
            let Some((_, prepared)) = prepare(name, &source) else {
                return;
            };
            assert!(!prepared.program.funcs.iter().any(|f| f.name == "run"));
            assert!(
                prepared
                    .diagnostics
                    .iter()
                    .any(|d| d.message.contains(expected)),
                "{:?}",
                prepared.diagnostics
            );
        }
    }
}

#[test]
fn conflicting_authored_abis_and_runtime_symbol_collisions_are_errors() {
    for (name, source, expected) in [
        (
            "overloads",
            r"
            declare function foreign(n: c_int): c_int;
            declare function foreign(n: c_double): c_double;
            export function a(n: number): number { return foreign(n as c_int); }
            export function b(n: number): number { return foreign(n as c_double); }
        ",
            "conflicting ABI declarations",
        ),
        (
            "runtime",
            r"
            declare function nts_math_pow(n: c_int): c_int;
            export function run(n: number): number { return nts_math_pow(n as c_int); }
        ",
            "collides with a runtime or compiled function",
        ),
    ] {
        let Some((_, prepared)) = prepare(name, source) else {
            return;
        };
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let emitted = nts_codegen_c::emit(&prepared.program);
        assert!(!emitted.is_complete(), "{name}: {}", emitted.writer.text());
        assert!(
            emitted
                .diagnostics
                .iter()
                .any(|d| d.message.contains(expected)),
            "{:?}",
            emitted.diagnostics
        );
    }
}

#[test]
fn unrelated_declarations_cannot_supply_a_calls_abi() {
    // Deliberately omit the shipped types file: importing every brand would
    // populate the snapshot before either arm asks whether a lone type works.
    let types = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/native/libc.d.ts"
    ));
    for declaration in types
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("export type c_") && line.contains("unique symbol"))
    {
        let brand = declaration.split_whitespace().nth(2).unwrap();
        for (position, call) in [
            (
                "parameter",
                format!(
                    "declare function native_value(n: {brand}): void;\nexport function run(n: number): void {{ native_value(n as {brand}); }}"
                ),
            ),
            (
                "return",
                format!(
                    "declare function native_value(): {brand};\nexport function run(): number {{ return native_value() + 0.25; }}"
                ),
            ),
        ] {
            let mut original = None;
            for witness in [
                "",
                "declare function unrelated(n: number & { readonly __c_double: unique symbol }): void;",
            ] {
                let declaration = declaration.strip_prefix("export ").unwrap();
                let source = format!("{declaration}\n{witness}\n{call}");
                let Some((_, prepared)) =
                    prepare_with_types(&format!("{brand}-{position}"), &source, false)
                else {
                    return;
                };
                assert!(
                    prepared.diagnostics.is_empty(),
                    "{brand}-{position}: {:?}",
                    prepared.diagnostics
                );
                assert!(prepared.program.funcs.iter().any(|f| f.name == "run"));
                let emitted = nts_codegen_c::emit(&prepared.program);
                assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
                let text = emitted.writer.text().to_owned();
                assert!(text.contains("native_value("));
                if let Some(original) = &original {
                    assert_eq!(&text, original, "{brand}-{position}");
                } else {
                    original = Some(text);
                }
            }
        }
    }
}

#[test]
fn curated_libc_bindings_match_system_headers_and_call_the_real_symbols() {
    let source = r#"
        import type { c_int, c_long, c_float, c_double } from "c:types";
        import { abs, labs } from "c:stdlib";
        import { fabs, fabsf, sqrtf, pow, fmod, floor, ceil, trunc, copysign, ldexp } from "c:math";
        import * as math from "c:math";
        export function run(n: number): number {
            return abs(n as c_int) + labs(n as c_long)
                + fabs(-1.25 as c_double) + fabsf(-1.25 as c_float)
                + math.sqrt(4 as c_double) + sqrtf(4 as c_float)
                + pow(2 as c_double, 3 as c_double)
                + fmod(5.5 as c_double, 2 as c_double)
                + floor(1.75 as c_double) + ceil(1.25 as c_double)
                + trunc(-1.75 as c_double)
                + copysign(1.25 as c_double, -1 as c_double)
                + ldexp(1.25 as c_double, 2 as c_int);
        }
    "#;
    let Some((dir, prepared)) = prepare_with_types("libc", source, false) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let declarations = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/native/libc.d.ts"
    ));
    // The shipped surface now includes compiler operations as well as libc.
    // Only an explicitly tagged intrinsic has no linker symbol to exercise.
    let mut intrinsic = false;
    for line in declarations.lines().map(str::trim) {
        if line.contains("@ntsAbi intrinsic") { intrinsic = true; }
        let Some(function) = line.strip_prefix("export function ") else { continue; };
        if std::mem::take(&mut intrinsic) { continue; }
        let function = function.split('(').next().unwrap();
        assert!(
            text.contains(&format!("= {function}(")),
            "{function} must be called by its actual linker name"
        );
    }
    std::fs::write(dir.join("program.c"), text).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(
        dir.join("caller.c"),
        "#include \"program.h\"\nint main(void) { return run(-3.75) != 27.75; }\n",
    )
    .unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-fno-builtin",
            "-include",
            "stdlib.h",
            "-include",
            "math.h",
            "program.c",
            "caller.c",
            "-lm",
            "-o",
            "caller",
        ])
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    assert!(Command::new(dir.join("caller")).status().unwrap().success());
}

#[test]
fn type_headers_preserve_brands_and_boolean_abi() {
    let source = r#"
        import type * as stdint from "c:stdint";
        import type { size_t } from "c:stddef";
        import type { bool } from "c:stdbool";
        declare function native_alias(n: stdint.int32_t, length: size_t, flag: bool): bool;
        export function run(n: number): boolean {
            return native_alias(n as stdint.int32_t, 1 as size_t, true);
        }
    "#;
    let Some((dir, prepared)) = prepare_with_types("type-headers", source, false) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert!(
        emitted
            .writer
            .text()
            .contains("bool native_alias(int32_t, size_t, bool);")
    );
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(
        dir.join("caller.c"),
        r#"
        #include "program.h"
        bool native_alias(int32_t n, size_t length, bool flag) {
            return n == -3 && length == 1 && flag;
        }
        int main(void) { return !run(-3.75); }
    "#,
    )
    .unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            "program.c",
            "caller.c",
            "-o",
            "caller",
        ])
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    assert!(Command::new(dir.join("caller")).status().unwrap().success());
}
