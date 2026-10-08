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

/// A program whose binding lives in its own declaration file, the way a real
/// one does.
///
/// Not a convenience: `declare module "c:x"` inside a file that imports or
/// exports anything is a module *augmentation*, and augmenting a module that
/// does not exist is `TS2664`. A binding has to arrive as an ambient
/// declaration in a file of its own, so a test that inlines it is not testing
/// the shape anybody writes.
fn prepare_with_binding(
    name: &str,
    binding: &str,
    source: &str,
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
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

fn prepare_with_types(
    name: &str,
    source: &str,
    include_types: bool,
) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let (dir, snapshot) = snapshot_with_types(name, source, include_types)?;
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

fn snapshot_with_types(
    name: &str,
    source: &str,
    include_types: bool,
) -> Option<(Utf8PathBuf, nts_semantic_schema::SemanticSnapshot)> {
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
        "import type { c_char, c_int, c_uint, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_long, c_ulong, c_size_t, c_ptrdiff_t, c_float, c_double } from \"c:types\";\n"
    } else {
        ""
    };
    std::fs::write(dir.join("main.ts"), format!("{imports}{source}")).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, snapshot))
}

#[path = "../../common/test-support/native_cases.rs"]
mod native_cases;
use native_cases::{CASES, WIDE_CASES, WINDOWS_ONLY};

#[test]
#[allow(clippy::too_many_lines)] // Two generated families and their C consumer.
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
    // Both families together: a brand belongs to exactly one, and a brand in
    // neither is a shipped scalar nothing checks against C.
    let covered: std::collections::BTreeSet<_> =
        CASES.iter().chain(WIDE_CASES).map(|case| case.0).chain(WINDOWS_ONLY.iter().copied()).collect();
    assert_eq!(
        published, covered,
        "each shipped scalar needs an independent C ABI case"
    );
    for wide in WIDE_CASES {
        assert!(
            !CASES.iter().any(|narrow| narrow.0 == wide.0),
            "{} is in both families; one of them is describing it wrongly",
            wide.0
        );
    }
    let mut ts = String::new();
    let mut header = "#include <stdint.h>\n#include <stddef.h>\n".to_owned();
    let mut implementation = "#include \"native.h\"\n".to_owned();
    let mut caller = "#include \"program.h\"\n#include \"native.h\"\nint main(void) {\n".to_owned();
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
    // The 64-bit family, whose values a `double` cannot carry. A round trip is
    // the whole test: C seeds a value, TypeScript reads it and hands it back,
    // and C compares. Nothing here is spelled as a `number`, which is the
    // point -- the previous version of this file routed every one of these
    // through one and returned INT64_MAX as INT64_MIN.
    for (i, (brand, c_type, literal, c_literal)) in WIDE_CASES.iter().enumerate() {
        write!(
            ts,
            "declare function wide_give_{i}(): {brand};\n\
             declare function wide_take_{i}(n: {brand}): void;\n\
             export function wide_round_{i}(): void {{ wide_take_{i}(wide_give_{i}()); }}\n\
             export function wide_literal_{i}(): void {{ wide_take_{i}({literal} as {brand}); }}\n"
        )
        .unwrap();
        write!(
            header,
            "{c_type} wide_give_{i}(void);\nvoid wide_take_{i}({c_type});\n{c_type} wide_seen_{i}(void);\nvoid wide_reset_{i}(void);\n"
        )
        .unwrap();
        write!(
            implementation,
            "static {c_type} wide_held_{i};\n\
             {c_type} wide_give_{i}(void) {{ return ({c_type})({c_literal}); }}\n\
             void wide_take_{i}({c_type} n) {{ wide_held_{i} = n; }}\n\
             {c_type} wide_seen_{i}(void) {{ return wide_held_{i}; }}\n\
             void wide_reset_{i}(void) {{ wide_held_{i} = 0; }}\n"
        )
        .unwrap();
        writeln!(
            caller,
            "wide_round_{i}(); if (wide_seen_{i}() != ({c_type})({c_literal})) return {};\n\
             wide_reset_{i}(); wide_literal_{i}(); if (wide_seen_{i}() != ({c_type})({c_literal})) return {};",
            100 + i * 2,
            101 + i * 2,
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
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
        .args(["native.o", "program.o", "caller.o", "-lm", "-o", "caller"])
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
            "parameter `n` (which wants a c_int or c_double brand, a boolean, or a string), a type with no native ABI",
        ),
        (
            "return",
            "declare function bad(n: c_int): number;",
            "bad(n as c_int)",
            "return (which wants a c_int or c_double brand, a boolean, or a string, or void), a type with no native ABI",
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
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
        // The base the brand is written over, read from the declaration rather
        // than from a list here: a second list would be a second derivation of
        // something this line already says, and it would go stale the first
        // time a brand moved between the families.
        let (base, unit) = if declaration.contains("= bigint") {
            ("bigint", "1n")
        } else {
            ("number", "1")
        };
        for (position, call) in [
            (
                "parameter",
                format!(
                    "declare function native_value(n: {brand}): void;\nexport function run(n: {base}): void {{ native_value(n as {brand}); }}"
                ),
            ),
            (
                "return",
                format!(
                    "declare function native_value(): {brand};\nexport function run(): {base} {{ return native_value() + {unit}; }}"
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
                // A Windows-only brand is emitted where it exists: the
                // question is whether an unrelated declaration can change the
                // call, which Win64 asks as well as SysV does.
                let abi = if WINDOWS_ONLY.contains(&brand) {
                    nts_core::hir::native::NativeAbi::Win64
                } else {
                    nts_core::hir::native::NativeAbi::SysV
                };
                let emitted = nts_codegen_c::emit(&prepared.program, abi);
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
        import { abs, exit, labs } from "c:stdlib";
        import { fabs, fabsf, sqrtf, pow, fmod, floor, ceil, trunc, copysign, ldexp } from "c:math";
        import * as math from "c:math";
        export function run(n: number): number {
            // `exit` is called where the caller's argument never goes: its
            // prototype still meets `stdlib.h`'s, and its call is emitted.
            if (n > 1e300) exit(3 as c_int);
            // `long` is 64 bits here and bigint-branded. A literal rather than
            // `BigInt(n)`, which is a runtime call this translation unit does
            // not link -- the value is the same one `(long)(-3.75)` gave.
            return abs(n as c_int) + Number(labs(-3n as c_long))
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
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let declarations = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/native/libc.d.ts"
    ));
    // The shipped surface now includes compiler operations as well as libc.
    // Only an explicitly tagged intrinsic has no linker symbol to exercise:
    // a backend's (`@ntsAbi intrinsic`) or a family's declaration the
    // lowering defines (`@ntsIntrinsic gobject.property`).
    let mut intrinsic = false;
    for line in declarations.lines().map(str::trim) {
        if line.contains("@ntsAbi intrinsic") || line.contains("@ntsIntrinsic ") { intrinsic = true; }
        let Some(function) = line.strip_prefix("export function ") else { continue; };
        if std::mem::take(&mut intrinsic) { continue; }
        let function = function.split('(').next().unwrap();
        // A function answering nothing is called as a statement.
        assert!(
            text.contains(&format!("= {function}(")) || text.contains(&format!("    {function}(")),
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
            return native_alias(n as stdint.int32_t, 1n as size_t, true);
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
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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

/// A never-free program keeps a `GObject` a foreign call hands it
/// (`hir::floating`), and so links the file that defines how: a program that
/// makes a widget and connects nothing called `nts_gobject_made` and failed to
/// link, because the support file came only with a connect, a registration,
/// a boxed record or an erased handle.
#[test]
fn a_gobject_a_call_hands_a_never_free_program_brings_the_support_file() {
    let binding = "declare module \"c:w\" {\n\
         import type { GObjectClass } from \"c:types\";\n\
         export type Widget = GObjectClass<\"_Widget\">;\n\
         export function widget_new(): Widget;\n\
         export function widget_mark(widget: Widget): void;\n\
         }\n";
    let program = "import { widget_new, widget_mark } from \"c:w\";\n\
         export function run(): void {\n\
         widget_mark(widget_new());\n\
         }\n";
    let Some((_, prepared)) = prepare_with_binding("gobject-made", binding, program) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.writer.text().contains("nts_gobject_made("), "a never-free program keeps nothing it is handed");
    let files: Vec<&str> = emitted.support_files().iter().map(|file| file.name).collect();
    assert!(
        files.contains(&nts_codegen_c::GOBJECT_SOURCE_NAME),
        "the program calls `nts_gobject_made` and does not link its definition: {files:?}"
    );
}

/// Two declarations of one C symbol that disagree, and what the emitter does
/// with a refusal it cannot act on.
///
/// Lowering refuses by **dropping** the function it names, so its output is a
/// smaller program and `emit-c` exits 0 for it on purpose. The emitter cannot
/// drop anything -- by then the body is written -- so this refusal leaves the
/// function in, calling through the other declaration's prototype. The
/// resulting `program.c` compiled, and every `build.sh` here runs `set -e`
/// against an exit code that was 0.
///
/// So the emitter's diagnostics are fatal at the CLI, and this is the shape
/// that has to produce one. The second arm is what makes it a check: the same
/// program with the two declarations agreeing must emit cleanly, or this would
/// pass on a compiler that refused every native call.
#[test]
fn two_declarations_of_one_symbol_that_disagree_are_refused() {
    let program = |cast: &str| format!("import {{ collide as viaOne }} from \"c:a\";\n\
         import {{ collide as viaTwo }} from \"c:b\";\n\
         import type {{ Ptr, c_int, c_size_t }} from \"c:types\";\n\
         export function one(fd: number, buf: Ptr<c_int>): number {{\n\
         return Number(viaOne(fd as c_int, buf, 4 as c_int));\n\
         }}\n\
         export function two(fd: number, buf: Ptr<c_int>): number {{\n\
         return Number(viaTwo(fd as c_int, buf, {cast}));\n\
         }}\n");
    // The arms differ in one thing: `b`'s third parameter. Both are pointers a
    // caller passes in, so neither call is an escape of local storage -- which
    // is what the first version of this measured instead, both arms having been
    // refused before they reached the emitter.
    let binding = |count: &str| {
        format!(
            "declare module \"c:a\" {{\n\
             import type {{ Ptr, c_int }} from \"c:types\";\n\
             export function collide(fd: c_int, buf: Ptr<c_int>, count: c_int): c_int;\n\
             }}\n\
             declare module \"c:b\" {{\n\
             import type {{ Ptr, c_int, c_size_t }} from \"c:types\";\n\
             export function collide(fd: c_int, buf: Ptr<c_int>, count: {count}): c_int;\n\
             }}\n"
        )
    };

    let Some((_, agreeing)) =
        prepare_with_binding("abi-agree", &binding("c_int"), &program("4 as c_int"))
    else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(agreeing.diagnostics.is_empty(), "{:?}", agreeing.diagnostics);
    let emitted = nts_codegen_c::emit(&agreeing.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(
        emitted.diagnostics.is_empty(),
        "two declarations that agree are one ABI: {:?}",
        emitted.diagnostics
    );

    let (_, conflicting) =
        prepare_with_binding("abi-conflict", &binding("c_size_t"), &program("4n as c_size_t"))
            .unwrap();
    assert!(conflicting.diagnostics.is_empty(), "{:?}", conflicting.diagnostics);
    let emitted = nts_codegen_c::emit(&conflicting.program, nts_core::hir::native::NativeAbi::SysV);
    let refusal = emitted
        .diagnostics
        .iter()
        .find(|d| d.code == "NTS2007")
        .unwrap_or_else(|| panic!("no NTS2007: {:?}", emitted.diagnostics));
    // **The words, not just the category.** What this refusal buys is not that
    // the program fails -- delete the check and the C compiler still refuses,
    // saying `conflicting types for 'collide'` about a `program.c` nobody
    // wrote. What it buys is naming the symbol and *both* prototypes, so the
    // author can see which two declarations disagree and how. A message that
    // degraded to "an ABI problem" would pass a test that asserted only the
    // category, and would have lost the entire value of the check.
    for expected in ["collide", "conflicting ABI declarations", "size_t", "int"] {
        assert!(
            refusal.message.contains(expected),
            "the refusal has to name `{expected}`, or it is worth less than the C compiler's: {}",
            refusal.message
        );
    }
    // And the reason the CLI treats this one as fatal while it tolerates the
    // rest. Both halves are asserted, because only the pair is a check: a
    // predicate that answered `true` for everything would pass the line below
    // and would have turned sixteen node modules from building into regressed,
    // which is exactly what the first version of it did.
    assert!(
        nts_codegen_c::leaves_the_program_inconsistent(refusal),
        "a conflicting ABI leaves a call declared wrongly: {}",
        refusal.message
    );
    let declines = nts_codegen_c::emit(&agreeing.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(
        declines
            .diagnostics
            .iter()
            .all(|d| !nts_codegen_c::leaves_the_program_inconsistent(d)),
        "nothing about the agreeing program is inconsistent: {:?}",
        declines.diagnostics
    );

    // What it emitted is a program, not a fragment. Both functions are in it,
    // and one of them calls through the other's prototype.
    let text = emitted.writer.text();
    assert!(text.contains("double one("), "the first function is emitted:\n{text}");
    assert!(
        text.contains("double two("),
        "and so is the one whose declaration lost, which is the whole problem:\n{text}"
    );
}

/// The witness a program publishes about a foreign type, checked against the
/// header that really declares it -- and checked that it can *fail*.
///
/// The arms differ in one thing: `events` is `c_int16` in one and `c_uint16` in
/// the other. On this target that changes no size, no alignment and no offset,
/// so the assertions a layout-only witness would carry are byte-identical
/// between them. That equality is asserted below rather than described, because
/// it is the whole reason the type assertions exist: a witness built from the
/// numbers alone passes a schema that is wrong about every value read through
/// it.
///
/// `-fsyntax-only`: nothing here needs to link or run. The question is whether
/// the translation unit that can see the real `struct pollfd` accepts what this
/// program believes about it.
#[test]
fn a_witness_agrees_with_the_real_header_and_refuses_a_schema_that_does_not() {
    const PROGRAM: &str = "import { poll, type PollFd, type Count, type Timeout } from \"c:poll\";\n\
         import { local } from \"c:memory\";\n\
         export function go(timeout: number): number {\n\
         const fds = local<PollFd>();\n\
         return poll(fds, 1n as Count, timeout as Timeout);\n\
         }\n";
    // `count` is the function's own claim, apart from the struct's: `c_ulong`
    // is what <poll.h> says `nfds_t` is.
    let binding = |field: &str, count: &str| {
        format!(
            "/** @ntsHeader poll.h */\n\
             declare module \"c:poll\" {{\n\
             import type {{ Ptr, Struct, c_int, c_long, {field}, c_ulong }} from \"c:types\";\n\
             export type PollFd = Struct<{{ fd: c_int; events: {field}; revents: {field} }}, \"pollfd\">;\n\
             export type Count = {count};\n\
             export type Timeout = c_int;\n\
             /** The array is read synchronously and no address into it is kept.\n\
              * @ntsNoEscape fds\n\
              */\n\
             export function poll(fds: Ptr<PollFd>, count: Count, timeout: Timeout): c_int;\n\
             }}\n"
        )
    };

    // `None` only when tsgo is absent. An empty witness is a *failure*, not a
    // skip: this program names a foreign struct and a foreign function, so a
    // witness with nothing in it means the generator stopped working. Reading
    // the two as one condition is how this test passed for its first three runs
    // while never executing a line of what it exists to check.
    let witness_of = |name: &str, field: &str, count: &str| -> Option<(Utf8PathBuf, String)> {
        let (dir, prepared) = prepare_with_binding(name, &binding(field, count), PROGRAM)?;
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(
            emitted.diagnostics.is_empty(),
            "{name}: {:?}",
            emitted.diagnostics
        );
        assert!(
            !emitted.witness.is_empty(),
            "{name}: a program naming `struct pollfd` and `poll` published no witness"
        );
        Some((dir, emitted.witness))
    };

    let Some((signed_dir, signed)) = witness_of("witness-signed", "c_int16", "c_ulong") else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let (unsigned_dir, unsigned) = witness_of("witness-unsigned", "c_uint16", "c_ulong").unwrap();
    // The function's type wrong and nothing else -- `long` where the header
    // says `unsigned long`, the same width -- so only the comparison of
    // `poll`'s own type can refuse it.
    let (narrow_dir, narrow) = witness_of("witness-signed-count", "c_int16", "c_long").unwrap();

    // The header's declaration compared with the binding's type, not a second
    // declaration of `poll`: an exact type, which is the check a
    // merely-convertible call expression is not. A re-declaration asked the
    // same question in a way Windows' `dllimport` headers refused for nothing.
    assert!(
        signed.contains(
            "__builtin_types_compatible_p(__typeof__(poll), int (struct pollfd *, unsigned long, int))"
        ),
        "the function's type is not compared with the header's:\n{signed}"
    );
    assert!(!signed.contains("extern int (poll)"), "a named header's function was re-declared:\n{signed}");

    let layout_only = |witness: &str| {
        witness
            .lines()
            .filter(|line| {
                line.contains("sizeof(") || line.contains("_Alignof(") || line.contains("offsetof(")
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert_eq!(
        layout_only(&signed),
        layout_only(&unsigned),
        "size, alignment and offsets must not distinguish these; if they do, this \
         test has stopped exercising the case it exists for"
    );
    assert_ne!(signed, unsigned, "the field types must distinguish them");

    // Compiled as it is generated. Nothing here supplies `#include <poll.h>`:
    // the binding names the header and the witness includes it, so what this
    // program is compared against is the binding's own claim rather than a
    // line in this test. While that line lived here, a binding naming the
    // wrong header would still have been checked against the right one.
    let accepted = |dir: &Utf8Path, witness: &str| -> bool {
        let file = dir.join(nts_codegen_c::NATIVE_WITNESS_NAME);
        std::fs::write(&file, witness).unwrap();
        Command::new("clang")
            .args(["-std=c11", "-fsyntax-only"])
            .arg(&file)
            .status()
            .unwrap()
            .success()
    };

    assert!(
        accepted(&signed_dir, &signed),
        "the correct binding must agree with the real <poll.h>"
    );
    assert!(
        !accepted(&unsigned_dir, &unsigned),
        "an unsigned `events` must be refused -- a witness that accepts both \
         arms is checking nothing about field types"
    );
    assert!(
        !accepted(&narrow_dir, &narrow),
        "`poll` taking a signed `long` for `nfds_t` must be refused -- a witness \
         that accepts it is checking nothing about function types"
    );
}

/// A function the witness checks against an included header is called through
/// that header's declaration, and every other keeps a prototype of its own.
///
/// **The first rule alone was a bug for a build.** `program.c` includes the
/// bindings' headers only when it needs a struct a header defines. A binding
/// of one function and no struct -- `windows-hello`'s `report` -- got no
/// include and, once its prototype was dropped, called an undeclared function.
/// So both arms are here: the same function and header, with and without a
/// header-defined struct beside it.
#[test]
fn a_witnessed_function_is_called_through_its_header_only_where_the_header_is_included() {
    // (name, binding, program, the function's own prototype line)
    let arms = [
        (
            "through-header",
            "/** @ntsHeader poll.h */\n\
             declare module \"c:poll\" {\n\
             import type { Ptr, Struct, c_int, c_int16, c_ulong } from \"c:types\";\n\
             export type PollFd = Struct<{ fd: c_int; events: c_int16; revents: c_int16 }, \"pollfd\">;\n\
             /** @ntsNoEscape fds */\n\
             export function poll(fds: Ptr<PollFd>, count: c_ulong, timeout: c_int): c_int;\n\
             }\n",
            "import { poll, type PollFd } from \"c:poll\";\nimport { local } from \"c:memory\";\n\
             import type { c_int, c_ulong } from \"c:types\";\n\
             export function go(): number { const fds = local<PollFd>(); return poll(fds, 0n as c_ulong, 0 as c_int); }\n",
            "int poll(",
        ),
        (
            "own-prototype",
            "/** @ntsHeader unistd.h */\n\
             declare module \"c:unistd\" {\n\
             import type { c_int } from \"c:types\";\n\
             export function getpid(): c_int;\n\
             }\n",
            "import { getpid } from \"c:unistd\";\nexport function go(): number { return getpid(); }\n",
            "int getpid(",
        ),
    ];
    for (name, binding, program, prototype) in arms {
        let Some((_, prepared)) = prepare_with_binding(name, binding, program) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(prepared.diagnostics.is_empty(), "{name}: {:?}", prepared.diagnostics);
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(emitted.is_complete(), "{name}: {:?}", emitted.diagnostics);
        let text = emitted.writer.text();
        let includes = text.lines().any(|line| line.starts_with("#include <") && !line.contains("std"));
        let declares = text.lines().any(|line| line.starts_with(prototype));
        if name == "through-header" {
            assert!(includes && !declares, "{name}: expected the header and no prototype of our own:\n{text}");
        } else {
            assert!(!includes && declares, "{name}: expected our own prototype, since no header is included:\n{text}");
        }
    }
}

/// A closure's call sits in the closure slot, numbered after every slot an
/// override claims: it is the first slot only in a program that overrides
/// nothing. The bridge read the first, so one `override` anywhere refused
/// every callback bridge in the program -- found when the Objective-C classes
/// of a binding briefly claimed slots.
#[test]
fn a_callback_bridge_finds_its_closure_beside_an_override() {
    let binding = r#"
/** @ntsHeader "bridge.h" */
declare module "c:bridge" {
  import type { c_int } from "c:types";
  export function apply(f: (n: c_int) => c_int, x: c_int): c_int;
}
"#;
    let program = |shapes: &str| {
        format!(
            r#"import {{ apply }} from "c:bridge";
import type {{ c_int }} from "c:types";
{shapes}
function addOne(n: c_int): c_int {{
  return (n + 1) as c_int;
}}
export function run(x: number): number {{
  return apply(addOne, x as c_int);
}}
"#
        )
    };
    let overriding = "class Shape { area(): number { return 1; } }\nclass Square extends Shape { override area(): number { return 4; } }\nexport function area(big: boolean): number { const s: Shape = big ? new Square() : new Shape(); return s.area(); }";
    for (name, shapes) in [("bridge-plain", ""), ("bridge-override", overriding)] {
        let Some((_, prepared)) = prepare_with_binding(name, binding, &program(shapes)) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(prepared.diagnostics.is_empty(), "{name}: {:?}", prepared.diagnostics);
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(emitted.diagnostics.is_empty(), "{name}: {:?}", emitted.diagnostics);
        assert!(emitted.writer.text().contains("addOne"), "{name}: the bridge calls `addOne`");
    }
}

/// `===` between two handles of related host classes is their identity, and C
/// can only state it through a common pointer type: `struct HostNode *` against
/// `struct HostElement *` is a constraint violation (C11 6.5.9p2) that clang
/// merely warns about. Reported by the Chromium lane (`target === button`).
#[test]
fn identity_between_related_host_handles_is_valid_c() {
    let source = r#"
import type { HostClass, c_int } from "c:types";
type Node = HostClass<"HostNode", null, "host_retain", "host_release">;
type Element = HostClass<"HostElement", Node>;
declare function node_at(i: c_int): Element;
declare function node_first(n: Node): Node | null;
export function related(): boolean { const e = node_at(0 as c_int); return node_first(e) === e; }
export function unrelatedOrder(): boolean { const e = node_at(0 as c_int); return e !== node_first(e); }
// Control: one class on both sides, which was already valid C.
export function sameType(): boolean { const e = node_at(0 as c_int); return node_first(e) === node_first(e); }
"#;
    let Some((dir, snapshot)) = snapshot_with_types("host-identity", source, false) else {
        return;
    };
    // A host handle needs the counting provider; a never-free program refuses it.
    let options = hir::Options { provider: hir::Provider::ReferenceCounting, ..hir::Options::default() };
    let prepared = hir::prepare_with(&snapshot, &options).unwrap();
    for name in ["related", "unrelatedOrder", "sameType"] {
        assert!(prepared.program.funcs.iter().any(|func| func.name == name),
            "{name} must reach the C it is compiled to: {:?}", prepared.diagnostics);
    }
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    let compiled = Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-Werror=compare-distinct-pointer-types", "-I"])
        .arg(dir.as_std_path())
        .arg(dir.join("program.c").as_std_path())
        .output()
        .expect("clang is required for the C backend's tests");
    assert!(
        compiled.status.success(),
        "{}\n--- program.c ---\n{}",
        String::from_utf8_lossy(&compiled.stderr),
        emitted.writer.text()
    );
}

/// A `number` passed to a C integer parameter goes through JavaScript's own
/// conversion, as `WebIDL`'s `long` and `GJS`'s `gint` take one: `ToInt32`,
/// `ToUint32` for an unsigned 32-bit parameter, and a narrowing of that for a
/// smaller one.
/// It was `(int32_t)v0`, which C leaves undefined for NaN, an infinity and
/// anything out of range -- clang folds `(int32_t)NAN` to whatever it likes.
/// A store through a native pointer (`p[0] = x`) takes the same conversion.
/// Reported by the Chromium lane; GTK's `gint` parameters take the same path.
#[test]
fn a_number_reaches_a_c_integer_through_to_int32() {
    let source = r#"
import type { CNumber, Ptr, c_int } from "c:types";
declare function seen_i32(v: CNumber<"int32">): CNumber<"double">;
declare function seen_u32(v: CNumber<"uint32">): CNumber<"double">;
declare function seen_i8(v: CNumber<"int8">): CNumber<"double">;
declare function seen_u16(v: CNumber<"uint16">): CNumber<"double">;
export function i32(x: number): number { return seen_i32(x); }
export function u32(x: number): number { return seen_u32(x); }
export function i8(x: number): number { return seen_i8(x); }
export function u16(x: number): number { return seen_u16(x); }
export function store(p: Ptr<c_int>, x: number): void { p[0] = x as c_int; }
export function storeNaN(p: Ptr<c_int>): void { p[1] = NaN as c_int; }
"#;
    let Some((dir, prepared)) = prepare_with_types("to-int32", source, false) else {
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(
        dir.join("native.c"),
        "#include <stdint.h>\n\
         double seen_i32(int32_t v) { return v; }\n\
         double seen_u32(uint32_t v) { return v; }\n\
         double seen_i8(int8_t v) { return v; }\n\
         double seen_u16(uint16_t v) { return v; }\n",
    )
    .unwrap();
    // Each expected value is node's: `x | 0`, `x >>> 0`, `(x << 24) >> 24` and
    // `x & 0xffff` are ToInt32, ToUint32, ToInt8 and ToUint16.
    std::fs::write(
        dir.join("caller.c"),
        "#include <math.h>\n#include <stdio.h>\n#include \"program.h\"\n\
         static int failed;\n\
         static void check(const char *what, double got, double want) {\n\
           if (got != want) { printf(\"FAIL %s: got %.17g want %.17g\\n\", what, got, want); failed = 1; }\n\
         }\n\
         int main(void) {\n\
           check(\"i32 2^32+5\", i32(4294967301.0), 5);\n\
           check(\"i32 2^31\", i32(2147483648.0), -2147483648.0);\n\
           check(\"i32 -1.9\", i32(-1.9), -1);\n\
           check(\"i32 NaN\", i32(NAN), 0);\n\
           check(\"i32 Infinity\", i32(INFINITY), 0);\n\
           check(\"u32 -1\", u32(-1), 4294967295.0);\n\
           check(\"u32 2^32+7\", u32(4294967303.0), 7);\n\
           check(\"i8 200\", i8(200), -56);\n\
           check(\"i8 -129.5\", i8(-129.5), 127);\n\
           check(\"u16 -1\", u16(-1), 65535);\n\
           check(\"u16 NaN\", u16(NAN), 0);\n\
           int slots[2] = { 7, 7 };\n\
           store(slots, 4294967301.0); check(\"store 2^32+5\", slots[0], 5);\n\
           store(slots, NAN); check(\"store NaN\", slots[0], 0);\n\
           store(slots, -1.9); check(\"store -1.9\", slots[0], -1);\n\
           storeNaN(slots); check(\"store constant NaN\", slots[1], 0);\n\
           return failed;\n\
         }\n",
    )
    .unwrap();
    let result = Command::new("clang")
        .current_dir(&dir)
        .args(["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-I", ".", "native.c", "program.c", "caller.c", "-lm", "-o", "caller"])
        .output()
        .unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let ran = Command::new(dir.join("caller")).output().unwrap();
    assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stdout));
}

/// A closure answering a host handle: where a signature returning `void`
/// admits it, a call through the signature drops the answer and runs; where a
/// signature reads the answer *as the closure answers it*, the call takes the
/// closure's typed entry and the handle passes unchanged; where the signature
/// reads it as a base, it is admitted too -- refused, where it is written,
/// until host handles had an erased form (`NTS_TAG_HANDLE_HOST`). The void case had compiled clean and aborted at run
/// time in the closure's erased entry (the Chromium lane's
/// `blockers/a-handle-returning-closure-called-as-void`); the first fix refused
/// every reading signature, which refused a local `const pick = (): Node =>
/// ...; pick()` too (`blockers/a-closure-returning-a-host-handle-is-refused-
/// since-a2`).
#[test]
fn a_closure_answering_a_host_handle_crosses_only_where_its_result_is_dropped() {
    let prelude = r#"
import type { HostClass, c_int } from "c:types";
type Node = HostClass<"HostNode", null, "host_retain", "host_release">;
type Leaf = HostClass<"HostLeaf", Node, "host_retain", "host_release">;
declare function node_at(i: c_int): Node;
declare function leaf_at(i: c_int): Leaf;
declare function node_value(n: Node): c_int;
"#;
    let prepare_rc = |name: &str, body: &str| {
        let (_, snapshot) = snapshot_with_types(name, &format!("{prelude}{body}"), false)?;
        let options = hir::Options { provider: hir::Provider::ReferenceCounting, ..hir::Options::default() };
        Some(hir::prepare_with(&snapshot, &options))
    };
    let Some(dropped) = prepare_rc("handle-result-dropped", r"
let calls = 0;
function invoke(f: () => void): void { f(); calls += 1; }
export function discarded(): number {
  invoke(() => node_at(1 as c_int));
  invoke(() => node_at(2 as c_int));
  return calls;
}
") else {
        return;
    };
    let dropped = dropped.unwrap();
    assert!(dropped.program.funcs.iter().any(|func| func.name == "discarded"), "{:?}", dropped.diagnostics);
    let emitted = nts_codegen_c::emit(&dropped.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert!(
        !emitted.writer.text().contains("nts_refused("),
        "a void-typed call reached an entry that refuses the handle result"
    );

    let Some(read) = prepare_rc("handle-result-read", r"
function read(f: () => Node): number { return node_value(f()); }
export function reads(): number { return read(() => node_at(1 as c_int)); }
") else {
        return;
    };
    let read = read.unwrap();
    assert!(
        !read.diagnostics.iter().any(|d| d.message.contains("no erased form")),
        "a signature reading the handle as the closure answers it was refused: {:?}",
        read.diagnostics
    );
    let emitted = nts_codegen_c::emit(&read.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert!(!emitted.writer.text().contains("nts_refused("), "a reading call reached a refusing entry");

    let Some(adapted) = prepare_rc("handle-result-read-as-a-base", r"
function read(f: () => Node): number { return node_value(f()); }
export function reads(): number { return read(() => leaf_at(1 as c_int)); }
") else {
        return;
    };
    // **Since `NTS_TAG_HANDLE_HOST` a host handle has an erased form**, so the
    // admission is no longer refused ("no erased form, passed where a signature
    // reads its result"), and the program it makes runs no refusing entry.
    let adapted = adapted.expect("valid HIR");
    assert!(
        !adapted.diagnostics.iter().any(|d| d.message.contains("no erased form")),
        "{:?}",
        adapted.diagnostics
    );
    let emitted = nts_codegen_c::emit(&adapted.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert!(!emitted.writer.text().contains("nts_refused("), "a base reading reached a refusing entry");
}

/// A foreign function answering a `Closure<F>` the program lent it (the
/// Chromium lane's request 14: `button.onclick` reads back the handler the
/// program set). The host keeps the context it was lent -- which *is* the
/// program's closure object -- and returns it retained. Run, not only
/// emitted: the closure handed back must be callable through its own
/// dispatch, `===` the one lent, and NULL must read as `null`; under both
/// providers, since reference counting is where a result's reference is
/// either the program's or a double release.
#[test]
fn a_closure_lent_to_c_comes_back_as_the_same_callable_closure() {
    let source = r#"
import type { Closure, c_double } from "c:types";
type Handler = Closure<(n: c_double) => c_double>;
declare function handler_set(handler: Handler): void;
declare function handler_get(): Handler | null;
declare function handler_clear(): void;
let calls = 0;
export function roundTrip(n: number): number {
  const step = n > 100 ? 3 : 2;
  const handler: Handler = (x: c_double): c_double => {
    calls += 1;
    return (x * step) as c_double;
  };
  handler_set(handler);
  const back = handler_get();
  if (back === null) return -1;
  const same = back === handler ? 1000 : 0;
  return same + (back(n as c_double) as number) + calls * 100;
}
export function cleared(): number {
  handler_clear();
  return handler_get() === null ? 1 : 0;
}
"#;
    let host = r#"#include "nts_runtime.h"
static void *held;
static void (*held_notify)(void *);
void handler_set(double (*bridge)(double, void *), void *context, void (*notify)(void *)) {
  (void)bridge;
  if (held != NULL) held_notify(held);
  held = context;
  held_notify = notify;
}
NtsHeader *handler_get(void) {
  if (held == NULL) return NULL;
  nts_retain((NtsHeader *)held);
  return (NtsHeader *)held;
}
void handler_clear(void) {
  if (held != NULL) held_notify(held);
  held = NULL;
}
"#;
    let caller = "#include \"program.h\"\n\
                  int main(void) {\n\
                  \x20 if (roundTrip(5) != 1000 + 10 + 100) return 1;\n\
                  \x20 if (roundTrip(200) != 1000 + 600 + 200) return 2;\n\
                  \x20 if (cleared() != 1) return 3;\n\
                  \x20 return 0;\n}\n";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let name = format!("closure-result-{provider:?}");
        let Some((dir, snapshot)) = snapshot_with_types(&name, source, false) else {
            return;
        };
        let options = hir::Options { provider, ..hir::Options::default() };
        let prepared = hir::prepare_with(&snapshot, &options).expect("valid HIR");
        assert!(prepared.diagnostics.is_empty(), "{provider:?}: {:?}", prepared.diagnostics);
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
        for file in emitted.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("host.c"), host).unwrap();
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        let mut objects = Vec::new();
        for source in ["program.c", "nts_runtime.c", "host.c", "caller.c"] {
            let object = format!("{source}.o");
            let mut args = vec!["-std=gnu11", "-D_GNU_SOURCE", "-O2", "-w", "-I", ".", "-c", source, "-o", &object];
            if provider == hir::Provider::ReferenceCounting {
                args.push("-DNTS_PROVIDER_RC");
            }
            let result = Command::new("clang").current_dir(&dir).args(&args).output().unwrap();
            assert!(result.status.success(), "{provider:?} {source}: {}", String::from_utf8_lossy(&result.stderr));
            objects.push(object);
        }
        let result = Command::new("clang")
            .current_dir(&dir)
            .args(&objects)
            .args(["-lm", "-lpthread", "-o", "caller"])
            .output()
            .unwrap();
        assert!(result.status.success(), "{provider:?}: {}", String::from_utf8_lossy(&result.stderr));
        let status = Command::new(dir.join("caller")).status().unwrap();
        assert!(status.success(), "{provider:?}: the caller answered {status}");
    }
}

/// A `StringView` member of a record passed by value, from an object the
/// program *holds* (`Fields<T>` in a variable, and a parameter handing one
/// on, which is how lib.dom's delegation reaches the binding) rather than
/// from a literal written at the call: the string is lent for the call, as a
/// literal's is. Run under reference counting with `-fsanitize=address`, since
/// the question is whether the string the host reads is alive and released
/// exactly once; heap strings, so a miscount is a use-after-free or a double
/// free and not a quiet no-op on an immortal constant.
#[test]
fn a_held_record_lends_its_string_member_for_the_call() {
    let binding = r#"
declare module "x:ev" {
  import type { ByValue, CBool, Fields, StringView, Struct, c_double, c_uint8 } from "c:types";
  export type Init = Struct<{ key: StringView | null; repeat: CBool<c_uint8> }, "EvInit">;
  /** @ntsSymbol ev_key_length */
  export function keyLength(init: ByValue<Init> | Fields<Init>): c_double;
}
"#;
    let source = r#"
import { keyLength, type Init } from "x:ev";
import type { Fields } from "c:types";
export function literal(n: number): number {
  return keyLength({ key: "k".repeat(n), repeat: true }) as number;
}
export function held(n: number): number {
  const init: Fields<Init> = { key: "k".repeat(n), repeat: true };
  return keyLength(init) as number;
}
interface KeyInit { key: string; repeat: boolean }
function handOn(init: KeyInit): number {
  return keyLength(init) as number;
}
export function handedOn(n: number): number {
  return handOn({ key: "x".repeat(n), repeat: false });
}
"#;
    let host = "#include <stddef.h>\n#include <stdint.h>\n#include <stdbool.h>\n#include \"nts_string_view.h\"\n\
                struct EvInit { const NtsBorrowedString *key; uint8_t repeat; };\n\
                double ev_key_length(struct EvInit init) {\n\
                \x20 if (init.key == NULL) return -1;\n\
                \x20 NtsStringView view = nts_string_view(init.key);\n\
                \x20 return (double)view.length + (init.repeat ? 1000 : 0);\n}\n";
    let caller = "#include \"program.h\"\n\
                  int main(void) {\n\
                  \x20 for (int i = 0; i < 50; i++) {\n\
                  \x20   if (literal(40) != 1040) return 1;\n\
                  \x20   if (held(30) != 1030) return 2;\n\
                  \x20   if (handedOn(20) != 20) return 3;\n\
                  \x20 }\n\
                  \x20 return 0;\n}\n";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else { return };
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
        let dir = root.join(format!("target/native-c-tests/{}-held-record-{provider:?}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts"]}}"#),
        )
        .unwrap();
        std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
        std::fs::write(dir.join("main.ts"), source).unwrap();
        let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let options = hir::Options { provider, ..hir::Options::default() };
        let prepared = hir::prepare_with(&snapshot, &options).expect("valid HIR");
        assert!(prepared.diagnostics.is_empty(), "{provider:?}: {:?}", prepared.diagnostics);
        let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
        for file in emitted.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("host.c"), host).unwrap();
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        let mut objects = Vec::new();
        for source in ["program.c", "nts_runtime.c", "host.c", "caller.c"] {
            let object = format!("{source}.o");
            let mut args = vec!["-std=gnu11", "-D_GNU_SOURCE", "-O1", "-g0", "-w", "-fsanitize=address", "-I", ".", "-c", source, "-o", &object];
            if provider == hir::Provider::ReferenceCounting {
                args.push("-DNTS_PROVIDER_RC");
            }
            let result = Command::new("clang").current_dir(&dir).args(&args).output().unwrap();
            assert!(result.status.success(), "{provider:?} {source}: {}", String::from_utf8_lossy(&result.stderr));
            objects.push(object);
        }
        let result = Command::new("clang")
            .current_dir(&dir)
            .args(&objects)
            .args(["-fsanitize=address", "-lm", "-lpthread", "-o", "caller"])
            .output()
            .unwrap();
        assert!(result.status.success(), "{provider:?}: {}", String::from_utf8_lossy(&result.stderr));
        let run = Command::new(dir.join("caller")).env("ASAN_OPTIONS", "detect_leaks=0").output().unwrap();
        assert!(run.status.success(), "{provider:?}: {}\n{}", run.status, String::from_utf8_lossy(&run.stderr));
    }
}
