//! Native ABI agreement against a separately compiled C implementation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::{fmt::Write, process::Command};

#[path = "../../common/test-support/native_cases.rs"]
mod native_cases;
use native_cases::{CASES, WIDE_CASES};

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

/// Two derivations of one bit-field layout, compared by running both.
///
/// The C backend emits `h->version` and lets `<netinet/ip.h>` decide where the
/// bits are. The LLVM backend has no C compiler to defer to, so it shifts and
/// masks using the positions `hir::layout` computed. A width or an offset this
/// compiler gets wrong is therefore **invisible in C** -- the emitted read is
/// correct whatever the binding claims -- and wrong here. Agreement is the only
/// thing that checks the claim.
#[test]
fn a_bit_field_reads_and_writes_the_same_bits_on_c_and_llvm() {
    let Some((dir, prepared)) = prepare_with_files(
        "bitfields",
        include_str!("../../common/test-support/native-bitfields/main.ts"),
        hir::Provider::NoGc,
        &[(
            "ip.d.ts",
            include_str!("../../common/test-support/native-bitfields/ip.d.ts"),
        )],
    ) else {
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
        include_str!("../../common/test-support/native-bitfields/caller.c"),
    )
    .unwrap();
    for source in ["caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
    }
    // The witness is compiled for its assertions, not linked. It carries the
    // record's `sizeof` and `_Alignof` and the offsets of the members that have
    // them -- a bit-field has neither an `offsetof` nor an address, so those
    // two lines are the only static check a run of them gets.
    clang(&dir, &["-std=c11", "-Wall", "-Wextra", "-Werror", "-fsyntax-only", "native_witness.c"]);
    for (source, object, binary) in [
        ("program.c", "c.o", "c-run"),
        ("program.ll", "llvm.o", "llvm-run"),
    ] {
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "caller.o", "nts_runtime.o", "-lm", "-o", binary]);
        assert!(
            Command::new(dir.join(binary)).status().unwrap().success(),
            "{binary}"
        );
    }
}

/// A flexible array member, read and written on both backends.
///
/// `struct cmsghdr` contributes no bytes for `__cmsg_data`, so the struct is 16
/// and the member is *at* 16. `caller.c` builds a real control message with the
/// platform's own `CMSG_SPACE`/`CMSG_LEN`/`CMSG_DATA` and asserts that the
/// address this compiler reaches is the one `CMSG_DATA` computes -- a
/// description that gave the member any extent puts every read past the
/// payload, and the two backends compute that address by different routes.
#[test]
fn a_flexible_array_member_reaches_the_bytes_after_the_record() {
    let Some((dir, prepared)) = prepare_with_files(
        "flexible",
        include_str!("../../common/test-support/native-flexible/main.ts"),
        hir::Provider::NoGc,
        &[(
            "cmsg.d.ts",
            include_str!("../../common/test-support/native-flexible/cmsg.d.ts"),
        )],
    ) else {
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
        include_str!("../../common/test-support/native-flexible/caller.c"),
    )
    .unwrap();
    for source in ["caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
    }
    // `offsetof` and `_Generic` both work on a flexible array member --
    // `unsigned char (*)[]` is a type C has -- so the witness checks it like
    // any other, which was verified against the real header before it was
    // written.
    clang(&dir, &["-std=c11", "-Wall", "-Wextra", "-Werror", "-fsyntax-only", "native_witness.c"]);
    for (source, object, binary) in [
        ("program.c", "c.o", "c-run"),
        ("program.ll", "llvm.o", "llvm-run"),
    ] {
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "caller.o", "nts_runtime.o", "-lm", "-o", binary]);
        assert!(
            Command::new(dir.join(binary)).status().unwrap().success(),
            "{binary}"
        );
    }
}

/// A record C names only by a typedef, on both backends.
///
/// `__sigset_t` is `typedef struct { ... } __sigset_t;` -- no tag, so C spells
/// it `__sigset_t` and `struct __sigset_t` is a *different*, incomplete type
/// the header never defines. `caller.c` includes the real `<signal.h>` beside
/// `program.h`, which is what would fail if this program declared the tagged
/// one: every assertion would then be about a type nothing defines.
#[test]
fn a_record_named_only_by_a_typedef_is_spelled_without_the_keyword() {
    let Some((dir, prepared)) = prepare_with_files(
        "typedef",
        include_str!("../../common/test-support/native-typedef/main.ts"),
        hir::Provider::NoGc,
        &[(
            "signal.d.ts",
            include_str!("../../common/test-support/native-typedef/signal.d.ts"),
        )],
    ) else {
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
        include_str!("../../common/test-support/native-typedef/caller.c"),
    )
    .unwrap();
    for source in ["caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
    }
    // The witness names the type in every assertion it makes, so it is the file
    // that stops compiling first if the keyword comes back.
    clang(&dir, &["-std=c11", "-Wall", "-Wextra", "-Werror", "-fsyntax-only", "native_witness.c"]);
    for (source, object, binary) in [
        ("program.c", "c.o", "c-run"),
        ("program.ll", "llvm.o", "llvm-run"),
    ] {
        clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "caller.o", "nts_runtime.o", "-lm", "-o", binary]);
        assert!(
            Command::new(dir.join(binary)).status().unwrap().success(),
            "{binary}"
        );
    }
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

/// A `Class` handle is passed where an ancestor is declared, on both backends.
///
/// The C side stores the button's address and checks that each ancestor-typed
/// parameter receives exactly that address -- an upcast in `GObject`'s layout is
/// the same pointer, so anything else is a wrong conversion that happened to
/// compile. The emitted C spells the conversion as a cast to the ancestor's
/// tag, which the separately compiled prototypes then check.
#[test]
fn a_class_handle_upcasts_to_its_ancestors_on_both_backends() {
    let source = r#"
import type { Class, c_int } from "c:types";
type GObject = Class<"_GObject">;
type GtkWidget = Class<"_GtkWidget", GObject>;
type GtkButton = Class<"_GtkButton", GtkWidget>;
declare function button_new(): GtkButton;
declare function widget_is(w: GtkWidget): c_int;
declare function object_is(o: GObject): c_int;
declare function widget_or_null_is(w: GtkWidget | null): c_int;
export function run(): number {
    const b = button_new();
    return widget_is(b) + object_is(b) * 10 + widget_or_null_is(b) * 100;
}
"#;
    let Some((dir, prepared)) = prepare("class-upcast", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("(struct _GtkWidget *)"), "no conversion to the ancestor was emitted");
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), r"
struct _GObject { int kind; };
struct _GtkWidget { struct _GObject parent; };
struct _GtkButton { struct _GtkWidget parent; };
static struct _GtkButton the_button;
struct _GtkButton *button_new(void) { return &the_button; }
int widget_is(struct _GtkWidget *w) { return (void *)w == (void *)&the_button; }
int object_is(struct _GObject *o) { return (void *)o == (void *)&the_button; }
int widget_or_null_is(struct _GtkWidget *w) { return (void *)w == (void *)&the_button; }
").unwrap();
    std::fs::write(dir.join("caller.c"), r#"
#include "program.h"
int main(void) { return run() == 111.0 ? 0 : 1; }
"#).unwrap();
    for file in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
    }
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        assert!(Command::new(dir.join(executable)).status().unwrap().success(), "{executable}");
    }
}

/// A checked downcast answers the object when it is a `T` and null when it is
/// not, on both backends; and the directions no check could make right are
/// refused before any check runs.
///
/// The class system is a fake one in C -- a `kind` in each object's first
/// field -- so the test does not need GTK. What it checks is the compiler's
/// half: that `is` true yields the same address as the requested type, `is`
/// false and a null value yield null, and a sideways cast or an upcast is
/// refused however `is` was computed.
#[test]
fn an_unsafe_downcast_follows_its_check_and_refuses_what_no_check_can_fix() {
    let source = r#"
import type { Class, c_int } from "c:types";
import { unsafeDowncast } from "c:memory";
type Obj = Class<"_Obj">;
type Widget = Class<"_Widget", Obj>;
type Box = Class<"_Box", Widget>;
declare function make(kind: c_int): Widget | null;
declare function kind_of(o: Obj): c_int;
declare function box_items(b: Box): c_int;
function asBox(w: Widget | null): Box | null {
    return unsafeDowncast<Box>(w, w !== null && kind_of(w) === 1);
}
export function run(kind: number): number {
    const b = asBox(make(kind as c_int));
    return b === null ? -1 : box_items(b);
}
"#;
    let Some((dir, prepared)) = prepare("downcast", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), r"
#include <stddef.h>
struct _Obj { int kind; };
struct _Widget { struct _Obj parent; };
struct _Box { struct _Widget parent; int items; };
static struct _Box a_box = { { { 1 } }, 42 };
static struct _Widget a_label = { { 2 } };
struct _Widget *make(int kind) {
    return kind == 1 ? &a_box.parent : kind == 2 ? &a_label : NULL;
}
int kind_of(struct _Obj *o) { return o->kind; }
int box_items(struct _Box *b) { return b->items; }
").unwrap();
    std::fs::write(dir.join("caller.c"), r#"
#include "program.h"
int main(void) {
    if (run(1) != 42.0) return 1;  /* a box, read through as one */
    if (run(2) != -1.0) return 2;  /* a label is not a box */
    if (run(3) != -1.0) return 3;  /* null is not a box */
    return 0;
}
"#).unwrap();
    for file in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
    }
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        let status = Command::new(dir.join(executable)).status().unwrap();
        assert!(status.success(), "{executable}: arm {:?}", status.code());
    }

    for (label, cast) in [
        ("sideways", "unsafeDowncast<Label>(b, true)"),
        ("upward", "unsafeDowncast<Obj>(b, true)"),
    ] {
        let refused = format!(
            r#"
import type {{ Class }} from "c:types";
import {{ unsafeDowncast }} from "c:memory";
type Obj = Class<"_Obj">;
type Widget = Class<"_Widget", Obj>;
type Box = Class<"_Box", Widget>;
type Label = Class<"_Label", Widget>;
declare function a_box(): Box;
export function run(): boolean {{
    const b = a_box();
    return {cast} === null;
}}
"#
        );
        let Some((_, prepared)) = prepare(&format!("downcast-{label}"), &refused) else { return; };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains("not below it on its declared chain")),
            "{label}: {:?}",
            prepared.diagnostics
        );
    }
}

/// `object` is C's `void *`: any native pointer, the same address, and never a
/// managed value, on both backends.
///
/// `GObject`'s `gpointer` parameters -- `g_object_unref`, every signal function
/// -- take whatever handle is at hand, and TypeScript's `object` accepts one.
/// It also accepts `{}`, whose heap address C must never be handed; lowering
/// refuses that at the call, which is the arm that makes this a check.
#[test]
fn an_object_parameter_takes_any_handle_as_void_and_refuses_a_managed_value() {
    let source = r#"
import type { Class, c_int } from "c:types";
type Obj = Class<"_Obj">;
type Widget = Class<"_Widget", Obj>;
declare function a_widget(): Widget;
declare function same(p: object, q: object | null): c_int;
export function run(): number {
    const w = a_widget();
    return same(w, w) * 10 + same(w, null);
}
"#;
    let Some((dir, prepared)) = prepare("object-void", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("int same(void *, void *)"), "`object` did not become `void *`");
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), r"
#include <stddef.h>
struct _Widget { int kind; };
static struct _Widget the_widget;
struct _Widget *a_widget(void) { return &the_widget; }
int same(void *p, void *q) { return p == (void *)&the_widget ? (q == NULL ? 2 : q == p ? 1 : 3) : 9; }
").unwrap();
    std::fs::write(dir.join("caller.c"), "#include \"program.h\"\nint main(void) { return run() == 12.0 ? 0 : 1; }\n").unwrap();
    for file in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
    }
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        assert!(Command::new(dir.join(executable)).status().unwrap().success(), "{executable}");
    }

    let managed = r"
declare function takes(p: object): void;
export function run(): void { takes({ x: 1 }); }
";
    let Some((_, prepared)) = prepare("object-managed", managed) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("a managed value where C takes a pointer")),
        "a managed object reached a `void *`: {:?}",
        prepared.diagnostics
    );

    // And only where C takes it. An interface's method signature has no body
    // either, and reading that as C refused `async_hooks.emitInit`, which
    // hands its `resource: object` to `hook.init` -- a TypeScript function.
    let interface = r"
interface Hook { init(resource: object): number }
class Counter implements Hook { init(resource: object): number { return resource === null ? 0 : 1; } }
export function run(): number { const hook: Hook = new Counter(); return hook.init({ x: 1 }); }
";
    let Some((_, prepared)) = prepare("object-interface", interface) else { return; };
    assert!(prepared.diagnostics.is_empty(), "a TypeScript method taking `object` was read as C: {:?}", prepared.diagnostics);

    // Nor under `@ntsAbi managed`, whose convention passes the object itself:
    // `async_hooks.registerDestroyHook` hands one to `nts_on_collected`.
    let managed_abi = r"
/** @ntsAbi managed */
declare function keep(value: object): void;
export function run(): void { keep({ x: 1 }); }
";
    let Some((_, prepared)) = prepare("object-managed-abi", managed_abi) else { return; };
    assert!(prepared.diagnostics.is_empty(), "an `@ntsAbi managed` object parameter was read as C: {:?}", prepared.diagnostics);
}

/// A downcast written as an assertion is refused by lowering.
///
/// TypeScript accepts `widget as GtkButton`: the two types overlap, which is
/// all an assertion asks. A compiler trusting the checker would hand C a
/// widget where a button is read, at a fabricated offset -- a wrong answer
/// rather than a refusal. `upcasts_to` would refuse the conversion too; the
/// assertion is stopped before it gets there, and this is the arm that says so.
#[test]
fn a_class_downcast_by_assertion_is_refused() {
    let source = r#"
import type { Class } from "c:types";
type GObject = Class<"_GObject">;
type GtkWidget = Class<"_GtkWidget", GObject>;
type GtkButton = Class<"_GtkButton", GtkWidget>;
declare function widget_new(): GtkWidget;
declare function button_label(b: GtkButton): void;
export function run(): void {
    button_label(widget_new() as GtkButton);
}
"#;
    let Some((_, prepared)) = prepare("class-downcast", source) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("asserted to be an opaque C pointer")),
        "a downcast by assertion was not refused: {:?}",
        prepared.diagnostics
    );
}

/// A capturing closure crosses to C and back, on both backends and both
/// providers, and a retained one is released when C lets go.
///
/// The fixture is `examples/interop/native-closure`'s own library and caller:
/// captures read back after C calls them, two closures through one C function
/// each reaching their own variable, and a closure registered by a function
/// that has returned by the time C calls it.
///
/// Under reference counting, the release is counted. The baseline is taken
/// before anything subscribes, and fifty subscribe/deliver/unsubscribe cycles
/// must leave `nts_live_count` exactly where it was -- a single cycle would
/// pass an off-by-one that fifty expose. The control is the same run with the
/// library told to forget without calling the destroy function, which must
/// leave every cycle's closure and the box it captured alive.
#[test]
fn a_capturing_closure_crosses_to_c_on_both_backends() {
    let source = include_str!("../../../../examples/interop/native-closure/src/main.ts");
    let declarations = [("closures.d.ts", include_str!("../../../../examples/interop/native-closure/types/closures.d.ts"))];
    for (label, provider) in [("nogc", hir::Provider::NoGc), ("rc", hir::Provider::ReferenceCounting)] {
        let Some((dir, prepared)) = prepare_with_files(&format!("closure-{label}"), source, provider, &declarations) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("closures.h"), include_str!("../../../../examples/interop/native-closure/native/closures.h")).unwrap();
        std::fs::write(dir.join("closures.c"), include_str!("../../../../examples/interop/native-closure/native/closures.c")).unwrap();
        std::fs::write(dir.join("caller.c"), include_str!("../../../../examples/interop/native-closure/consumer/caller.c")).unwrap();
        std::fs::write(dir.join("cycles.c"), SIGNAL_CYCLES).unwrap();
        let counted: &[&str] = if provider == hir::Provider::ReferenceCounting { &["-DNTS_PROVIDER_RC"] } else { &[] };
        for file in ["closures.c", "caller.c", "cycles.c"] {
            clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
        }
        clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], counted].concat());
        for (source, object, executable) in [("program.c", "c.o", "c"), ("program.ll", "llvm.o", "llvm")] {
            clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], counted].concat());
            clang(&dir, &[object, "closures.o", "caller.o", "nts_runtime.o", "-lm", "-o", &format!("{executable}-run")]);
            let run = Command::new(dir.join(format!("{executable}-run"))).output().unwrap();
            assert!(run.status.success(), "{label}/{executable}: {}", String::from_utf8_lossy(&run.stdout));
            if provider != hir::Provider::ReferenceCounting {
                continue;
            }
            clang(&dir, &[object, "closures.o", "cycles.o", "nts_runtime.o", "-lm", "-o", &format!("{executable}-cycles")]);
            let counts = |args: &[&str]| -> (u64, u64) {
                let run = Command::new(dir.join(format!("{executable}-cycles"))).args(args).output().unwrap();
                assert!(run.status.success(), "{label}/{executable} cycles");
                let text = String::from_utf8_lossy(&run.stdout).into_owned();
                let mut numbers = text.split_whitespace().map(|n| n.parse::<u64>().unwrap());
                (numbers.next().unwrap(), numbers.next().unwrap())
            };
            let (before, after) = counts(&[]);
            assert_eq!(before, after, "{executable}: fifty released cycles left objects alive");
            let (before, after) = counts(&["skip-notify"]);
            assert!(
                after >= before + 50,
                "{executable}: the control released what was never given back ({before} -> {after}), so the count proves nothing"
            );
        }
    }
}

/// What a closure crossing to C still may not do.
///
/// A capturing arrow where the declaration says a *plain* function pointer is
/// refused as before: that parameter has no context, so there is nowhere to
/// put what it captured. And a throw inside a lent closure stops at the
/// boundary, the same way a static one's does -- the trampoline dispatches to
/// the plain compiled function, never to a raising copy.
#[test]
fn a_closure_to_c_keeps_its_refusals_and_its_boundary() {
    let plain = r#"
import type { c_int } from "c:types";
declare function apply_twice(f: (n: c_int) => c_int, x: c_int): c_int;
export function run(k: number): number {
    return apply_twice((n) => (n + k) as c_int, 1 as c_int);
}
"#;
    let Some((_, prepared)) = prepare("closure-plain", plain) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("a C function pointer needs a function declared with `function`")),
        "a capturing arrow reached a plain function pointer: {:?}",
        prepared.diagnostics
    );

    let throwing = r#"
import type { ScopedClosure, c_int } from "c:types";
declare function each_upto(f: ScopedClosure<(n: c_int) => void>, upto: c_int): void;
export function run(limit: number): number {
    let seen = 0;
    each_upto((n) => {
        if (n > limit) throw new Error("past the limit");
        seen += n;
    }, 3 as c_int);
    return seen;
}
"#;
    let Some((dir, prepared)) = prepare("closure-throw", throwing) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), "void each_upto(void (*f)(int, void *), void *data, int upto) { for (int n = 1; n <= upto; n++) f(n, data); }\n").unwrap();
    std::fs::write(dir.join("caller.c"), r#"
#include <stdlib.h>
#include "program.h"
int main(int argc, char **argv) { (void)argv; return run(argc > 1 ? 1 : 10) == 6.0 ? 0 : 1; }
"#).unwrap();
    for file in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
    }
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        assert!(Command::new(dir.join(executable)).status().unwrap().success(), "{executable}: no throw");
        let thrown = Command::new(dir.join(executable)).arg("throw").output().unwrap();
        assert!(!thrown.status.success(), "{executable}: a throw inside a lent closure returned normally");
        assert!(
            String::from_utf8_lossy(&thrown.stderr).contains("a callback threw across a C boundary"),
            "{executable}: {}",
            String::from_utf8_lossy(&thrown.stderr)
        );
    }
}

/// A `string` parameter reaches C as NUL-terminated UTF-8, on both backends
/// and both providers.
///
/// The fixture is `examples/interop/native-string`'s own library and caller,
/// so what is checked here is what that example checks: C reads the bytes
/// back, "β😀" must answer differently from "α😀", and a string holding U+0000
/// stops at the boundary instead of reaching C truncated. The conversion is
/// lowering's, so both backends only call the runtime -- which is the claim a
/// second backend is here to test rather than to assume.
#[test]
fn a_string_parameter_crosses_as_utf8_on_both_backends() {
    let source = include_str!("../../../../examples/interop/native-string/src/main.ts");
    let declarations = [("text.d.ts", include_str!("../../../../examples/interop/native-string/types/text.d.ts"))];
    for (label, provider) in [("nogc", hir::Provider::NoGc), ("rc", hir::Provider::ReferenceCounting)] {
        let Some((dir, prepared)) = prepare_with_files(&format!("string-{label}"), source, provider, &declarations) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        assert!(llvm.text.contains("@nts_string_to_cstring("), "the conversion is not in the LLVM program");
        assert!(llvm.text.contains("@nts_cstring_release("), "the release is not in the LLVM program");
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("text.h"), include_str!("../../../../examples/interop/native-string/native/text.h")).unwrap();
        std::fs::write(dir.join("text.c"), include_str!("../../../../examples/interop/native-string/native/text.c")).unwrap();
        std::fs::write(dir.join("caller.c"), include_str!("../../../../examples/interop/native-string/consumer/caller.c")).unwrap();
        // Both halves counted or neither: the provider decides what the
        // program emits, and the runtime has to agree with it.
        let counted: &[&str] = if provider == hir::Provider::ReferenceCounting { &["-DNTS_PROVIDER_RC"] } else { &[] };
        for file in ["text.c", "caller.c"] {
            clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
        }
        clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], counted].concat());
        for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
            clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], counted].concat());
            clang(&dir, &[object, "text.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
            let run = Command::new(dir.join(executable)).output().unwrap();
            assert!(run.status.success(), "{label}/{executable}: {}", String::from_utf8_lossy(&run.stdout));
            let nul = Command::new(dir.join(executable)).arg("nul").output().unwrap();
            assert!(!nul.status.success(), "{label}/{executable}: U+0000 reached C");
            assert!(
                String::from_utf8_lossy(&nul.stderr).contains("containing U+0000 at index 1"),
                "{label}/{executable}: {}",
                String::from_utf8_lossy(&nul.stderr)
            );
        }
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
    // The 64-bit family through the same memory operations. Exactness has to
    // hold in *this* backend too: the C one and this one convert between `i64`
    // and the bigint separately, and a widening that read the destination's
    // signedness instead of the source's would turn UINT64_MAX into -1 here
    // while the C backend stayed right.
    let wide_brands = WIDE_CASES.iter().map(|case| case.0).collect::<std::collections::BTreeSet<_>>();
    let wide_brands = wide_brands.into_iter().collect::<Vec<_>>().join(", ");
    writeln!(source, "import type {{ {wide_brands} }} from \"c:types\";").unwrap();
    for (i, (brand, ctype, literal, c_literal)) in WIDE_CASES.iter().enumerate() {
        writeln!(source, "export function wide_mem_{i}(p: Ptr<{brand}>): void {{
            p[1] = {literal} as {brand};
        }}").unwrap();
        writeln!(caller, "{{ {ctype} slot[2] = {{0, 0}};
            wide_mem_{i}(slot);
            if (slot[1] != ({ctype})({c_literal})) return {};
        }}", 200 + i).unwrap();
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
        std::fs::write(dir.join("caller.c"), include_str!("../../../../examples/interop/native-poll/consumer/caller.c")).unwrap();
        std::fs::write(dir.join("layout.c"), include_str!("../../../../examples/interop/native-poll/native/layout.c")).unwrap();
        // The check, compiled and never linked. It used to live inside
        // `layout.c`, which also defines the functions `caller.c` prints from;
        // that file supplied the `#include <poll.h>` the witness was compared
        // against, so the comparison was against a header this test named
        // rather than one the binding did.
        clang(
            &dir,
            &["-Wall", "-Wextra", "-Werror", "-fsyntax-only", nts_codegen_c::NATIVE_WITNESS_NAME],
        );
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
        // The witness is the check: it includes the real <unistd.h>, named by
        // the binding itself, so `read`'s generated prototype has to agree with
        // the system one. Compiled here rather than only in build.sh, and never
        // linked -- it declares no symbol and defines no function.
        clang(
            &dir,
            &["-Wall", "-Wextra", "-Werror", "-fsyntax-only", nts_codegen_c::NATIVE_WITNESS_NAME],
        );
        for source in ["caller.c", "nts_runtime.c"] {
            clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
        }
        for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
            clang(
                &dir,
                &[object, "caller.o", "nts_runtime.o", "-lm", "-o", "caller"],
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
        "/** @ntsHeader unistd.h */\n\
         declare module \"c:unistd\" {\n\
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
         return Number(read(fd as Fd, buf, 8n as Count));\n\
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
    let witness = dir.join(nts_codegen_c::NATIVE_WITNESS_NAME);
    assert!(
        witness.exists(),
        "a program calling a foreign function published no witness"
    );
    // No wrapper: the binding names <unistd.h> and the generated file includes
    // it. What refuses this arm is therefore the declaration's own claim about
    // which header it describes, not a line in this test that could just as
    // easily have named a header the binding never mentioned.
    let refused = !Command::new("clang")
        .args(["-std=c11", "-fsyntax-only"])
        .arg(&witness)
        .status()
        .unwrap()
        .success();
    assert!(refused, "the real <unistd.h> accepted `read` with a uint8_t * buffer");
}

/// A struct stored inline in another, checked against the header that declares
/// both.
///
/// `struct itimerval` is two `struct timeval`s by value, which is the shape most
/// real C structs have and the one a header importer will meet immediately. The
/// point is not that a size comes out right -- it is that the *system header*
/// accepts every claim: both sizes, both alignments, every offset, and
/// `_Generic` on the nested member itself, which is `struct timeval *` and would
/// not be if the member had been described as a pointer or flattened away.
///
/// It also pins the emission order. A struct containing another by value needs
/// the inner one *complete*, and a forward declaration is not: emitting these in
/// name order put `itimerval` first and produced `field has incomplete type`.
/// `emit-c` reported success while doing it, so only compiling the output
/// catches it, which is what this does.
#[test]
fn an_inline_struct_member_agrees_with_the_system_header() {
    let source = "/** The structs are declared here rather than imported from a binding
          * module, so the *file* names the header -- a source file is a module
          * and this is the only place the claim can live.
          * @ntsHeader sys/time.h
          */
        import type { Ptr, Struct, c_long } from 'c:types';
        type TimeVal = Struct<{tv_sec: c_long; tv_usec: c_long}, 'timeval'>;
        type ITimerVal = Struct<{it_interval: TimeVal; it_value: TimeVal}, 'itimerval'>;
        // `long` is 64 bits here and so bigint-branded; the conversion out is
        // explicit rather than through a double.
        export function seconds(p: Ptr<ITimerVal>): number { return Number(p.it_value.tv_sec); }";
    let Some((dir, prepared)) = prepare("inline-struct-member", source) else {
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    // The program's own translation unit: an inline member the definitions were
    // emitted out of order for would fail here and nowhere earlier.
    clang(&dir, &["-std=c11", "-Wall", "-Wextra", "-Werror", "-fsyntax-only", "program.c"]);
    // And the witness, where the real <sys/time.h> is the one answering.
    clang(&dir, &["-std=c11", "-fsyntax-only", nts_codegen_c::NATIVE_WITNESS_NAME]);
    let witness = std::fs::read_to_string(dir.join(nts_codegen_c::NATIVE_WITNESS_NAME)).unwrap();
    assert!(
        witness.contains("struct timeval *: 1"),
        "the nested member's own type must be asserted, not only its offset:\n{witness}"
    );
}

/// C calling a compiled TypeScript function through a generated bridge.
///
/// A TypeScript function value is a managed closure object and C wants
/// something it can call, so the compiler emits a real function with the
/// foreign signature. The evidence is the separately compiled library actually
/// entering it: `apply_twice` calls the callback twice, so a bridge entered
/// once, or returning a constant, gives a different answer than 10 + 3 + 3.
///
/// Both backends, because the bridge is emitted per backend and a C-only check
/// would not notice LLVM producing nothing.
#[test]
fn c_calls_a_typescript_function_through_a_bridge() {
    let source = include_str!("../../../../examples/interop/native-callback/src/main.ts");
    let declarations = [(
        "library.d.ts",
        include_str!("../../../../examples/interop/native-callback/types/library.d.ts"),
    )];
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((dir, prepared)) =
            prepare_with_files("native-callback", source, provider, &declarations)
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
            include_str!("../../../../examples/interop/native-callback/consumer/caller.c"),
        )
        .unwrap();
        std::fs::write(
            dir.join("library.c"),
            include_str!("../../../../examples/interop/native-callback/native/library.c"),
        )
        .unwrap();
        // The library's header, which both `library.c` and the witness include.
        // It is what makes the callback signatures checkable at all: while this
        // library declared its functions only in its own `.c`, the witness
        // re-declared them next to nothing and agreed with itself.
        std::fs::write(
            dir.join("library.h"),
            include_str!("../../../../examples/interop/native-callback/native/library.h"),
        )
        .unwrap();
        clang(
            &dir,
            &["-Wall", "-Wextra", "-Werror", "-fsyntax-only", nts_codegen_c::NATIVE_WITNESS_NAME],
        );
        for source in ["caller.c", "library.c", "nts_runtime.c"] {
            clang(&dir, &["-O2", "-Wall", "-Wextra", "-Werror", "-c", source]);
        }
        for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
            clang(
                &dir,
                &[object, "caller.o", "library.o", "nts_runtime.o", "-lm", "-o", "caller"],
            );
            assert!(
                Command::new(dir.join("caller")).status().unwrap().success(),
                "{source} {provider:?}"
            );
        }
    }
}

#[test]
fn native_struct_rejections_preserve_the_valid_arm() {
    for (name, bad) in [
        ("aggregate-store", "export function bad(p: Ptr<State>): void { p[0] = p[1]; }"),
        ("spread", "export function bad(p: Ptr<State>): number { const copy = {...p}; return copy.count; }"),
        ("managed-address", "export function bad(): number { const p = {count: 1}; return addrOf(p.count)[0]; }"),
        ("plain-field", "type Bad = Struct<{count: number}>; export function bad(p: Ptr<Bad>): number { return p.count; }"),
        ("optional-field", "type Bad = Struct<{count?: c_int32}>; export function bad(p: Ptr<Bad>): number { return p.count ?? 0; }"),
        // A struct stored inline is supported; a struct that contains *itself*
        // by value is not a type C can lay out, and is the limit that replaced
        // this arm when nested members landed.
        ("self-nested", "type Loop = Struct<{n: c_int32; self: Loop}, 'loopy'>; export function bad(p: Ptr<Loop>): void { void p; }"),
        ("mutually-nested", "type L = Struct<{n: c_int32; r: R}, 'l'>; type R = Struct<{n: c_int32; l: L}, 'r'>; export function bad(p: Ptr<L>): void { void p; }"),
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
            const b = malloc(4n as c_size_t);
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

/// `g_signal_connect_data`'s contract and nothing more, for the test below.
const SIGNAL_REGISTRY: &str = r#"
#include <string.h>
typedef void (*GCallback)(void);
struct _GClosure { int unused; };
typedef void (*GClosureNotify)(void *, struct _GClosure *);
struct _Obj { int id; };
static struct _Obj the = { 7 };
static struct _GClosure a_closure;
struct _Obj *the_obj(void) { return &the; }
int obj_id(struct _Obj *o) { return o->id; }
static struct { const char *name; GCallback fn; void *data; GClosureNotify notify; } slots[2];
static int used;
int skip_notify;
unsigned long sig_connect_data(void *instance, const char *signal, GCallback fn, void *data, GClosureNotify notify, unsigned flags) {
    if (instance != &the || flags != 0 || used == 2) return 0;
    slots[used].name = strcmp(signal, "poke") == 0 ? "poke" : strcmp(signal, "ping") == 0 ? "ping" : "?";
    slots[used].fn = fn;
    slots[used].data = data;
    slots[used].notify = notify;
    return (unsigned long)++used;
}
void emit_all(int n) {
    for (int i = 0; i < used; i++) {
        if (slots[i].name[1] == 'o') ((void (*)(struct _Obj *, int, void *))slots[i].fn)(&the, n, slots[i].data);
        else ((void (*)(struct _Obj *, void *))slots[i].fn)(&the, slots[i].data);
    }
}
void drop_all(void) {
    for (int i = 0; i < used; i++) if (!skip_notify) slots[i].notify(slots[i].data, &a_closure);
    used = 0;
}
"#;

/// Fifty connect/emit/release cycles, then the live count before and after
/// and what the handlers added up; any argument skips the release.
const SIGNAL_CYCLES: &str = r#"
#include <stdio.h>
#include <stdlib.h>
#include "closures.h"
#include "program.h"
int main(int argc, char **argv) {
    module__init();
    (void)argv;
    closures_skip_notify = argc > 1;
    size_t before = nts_live_count();
    for (int cycle = 0; cycle < 50; cycle++) {
        start();
        send_(1);
        stop();
    }
    size_t after = nts_live_count();
    printf("%zu %zu\n", before, after);
    return 0;
}
"#;

/// A `GObject` signal, as `nts bind-gir` declares one: a typed view of
/// `g_signal_connect_data` per signal, each naming the one C symbol with
/// `@ntsSymbol`, whose handler C holds as an erased `GCallback` and calls with
/// the signature the signal has.
///
/// The fake registry here is that contract and nothing more: a handler stored
/// as `void (*)(void)` with its data and a two-argument notify, called through
/// a cast to the signal's own signature, released by calling the notify. Two
/// views of one symbol with different handler types check that the erased
/// prototype really is one prototype -- two spellings would not compile. The
/// `ping` handler takes fewer arguments than C passes, which is how a signal
/// handler that ignores its instance is written.
///
/// Fifty connect/emit/release cycles under reference counting must leave the
/// live count where it was; the control skips the notify and must not.
#[test]
fn a_typed_signal_view_calls_through_an_erased_callback_on_both_backends() {
    let source = r#"
import type { Class, Erased, ErasedClosure, Ptr, c_int, c_uint, c_ulong } from "c:types";
type Obj = Class<"_Obj">;
type GClosure = Class<"_GClosure">;
type Notify = (data: Ptr<unknown>, closure: GClosure) => void;
/** @ntsSymbol sig_connect_data */
declare function obj_connect_poke(instance: Erased<Obj>, signal: "poke", handler: ErasedClosure<(self: Obj, n: c_int) => void, Notify>, flags: c_uint): c_ulong;
/** @ntsSymbol sig_connect_data */
declare function obj_connect_ping(instance: Erased<Obj>, signal: "ping", handler: ErasedClosure<(self: Obj) => void, Notify>, flags: c_uint): c_ulong;
declare function the_obj(): Obj;
declare function obj_id(o: Obj): c_int;
let total = 0;
export function wire(k: number): void {
    const o = the_obj();
    obj_connect_poke(o, "poke", (self, n) => { total += obj_id(self) * n * k; }, 0 as c_uint);
    obj_connect_ping(o, "ping", () => { total += 1000 * k; }, 0 as c_uint);
}
export function tally(): number { return total; }
"#;
    for (label, provider) in [("nogc", hir::Provider::NoGc), ("rc", hir::Provider::ReferenceCounting)] {
        let Some((dir, prepared)) = prepare_with_provider(&format!("signal-{label}"), source, provider) else { return; };
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("signals.c"), SIGNAL_REGISTRY).unwrap();
        std::fs::write(dir.join("cycles.c"), r#"
#include <stdio.h>
#include "program.h"
extern int skip_notify;
void emit_all(int n);
void drop_all(void);
int main(int argc, char **argv) {
    module__init();
    (void)argv;
    skip_notify = argc > 1;
    size_t before = nts_live_count();
    for (int cycle = 0; cycle < 50; cycle++) {
        wire(2);
        emit_all(3);
        drop_all();
    }
    printf("%zu %zu %.0f\n", before, nts_live_count(), tally());
    return 0;
}
"#).unwrap();
        let counted: &[&str] = if provider == hir::Provider::ReferenceCounting { &["-DNTS_PROVIDER_RC"] } else { &[] };
        for file in ["signals.c", "cycles.c"] {
            clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
        }
        clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], counted].concat());
        for (source, object, executable) in [("program.c", "c.o", "c"), ("program.ll", "llvm.o", "llvm")] {
            clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], counted].concat());
            clang(&dir, &[object, "signals.o", "cycles.o", "nts_runtime.o", "-lm", "-o", &format!("{executable}-run")]);
            let counts = |args: &[&str]| -> (u64, u64, u64) {
                let run = Command::new(dir.join(format!("{executable}-run"))).args(args).output().unwrap();
                assert!(run.status.success(), "{label}/{executable}");
                let text = String::from_utf8_lossy(&run.stdout).into_owned();
                let numbers: Vec<u64> = text.split_whitespace().map(|n| n.parse().unwrap()).collect();
                (numbers[0], numbers[1], numbers[2])
            };
            // Per cycle: `poke` adds 7 * 3 * 2 through the instance C passed,
            // `ping` adds 1000 * 2 through the captured `k` alone.
            let (before, after, total) = counts(&[]);
            assert_eq!(total, 50 * (7 * 3 * 2 + 1000 * 2), "{label}/{executable}: the handlers did not run as connected");
            if provider != hir::Provider::ReferenceCounting {
                continue;
            }
            assert_eq!(before, after, "{executable}: fifty released signal handlers left objects alive");
            let (before, after, _) = counts(&["skip-notify"]);
            assert!(
                after >= before + 100,
                "{executable}: the control released what was never given back ({before} -> {after}), so the count proves nothing"
            );
        }
    }
}

/// An out parameter: stack storage C writes through, which is how `GLib`
/// returns a second value and how it reports an error (`GError **error`).
///
/// `local<GError | null>()` is one slot of a nullable handle, and its address
/// is C's `GError **`. `Ptr` used to distribute over the `| null`, which made
/// it a union of two pointer types no declaration spells, and `local` refused
/// it; and a slot of `GError | null` read as `never` for the null half. The arms
/// are C writing the error and C leaving it null, each read back through the
/// slot, plus an integer out parameter beside it.
#[test]
fn an_out_parameter_of_a_nullable_handle_is_one_slot_on_both_backends() {
    let source = r"
import type { Class, Ptr, c_int } from 'c:types';
import { local } from 'c:memory';
type GError = Class<'_GError'>;
/**
 * @ntsNoEscape out
 * @ntsNoEscape error
 */
declare function might(ok: c_int, out: Ptr<c_int>, error: Ptr<GError | null>): c_int;
export function attempt(ok: number): number {
    const n = local<c_int>();
    const error = local<GError | null>();
    const r = might(ok as c_int, n, error);
    if (error[0] !== null) return -1;
    return (r as number) * 100 + (n[0] as number);
}
";
    let Some((dir, prepared)) = prepare("out-parameter", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("struct _GError * *"), "the error slot's address is not a `GError **`");
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), r"
struct _GError { int code; };
static struct _GError failure = { 42 };
int might(int ok, int *out, struct _GError **error) {
    if (ok) { *out = 7; return 1; }
    *error = &failure;
    return 0;
}
").unwrap();
    std::fs::write(dir.join("caller.c"), "#include \"program.h\"\nint main(void) { return attempt(1) == 107.0 && attempt(0) == -1.0 ? 0 : 1; }\n").unwrap();
    for file in ["native.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file]);
    }
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &["-O2", "-Wno-override-module", "-c", source, "-o", object]);
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        assert!(Command::new(dir.join(executable)).status().unwrap().success(), "{executable}");
    }
}

/// A program and the C library it calls, built for `provider` on both
/// backends and run: the C text, to assert spellings on, and each backend's
/// output.
///
/// Under reference counting everything is compiled with `NTS_PROVIDER_RC`,
/// so a `caller` can ask `nts_live_count` -- and a lent or copied array that
/// leaks, or is freed early, shows there rather than nowhere.
fn run_on_both_backends(
    name: &str,
    source: &str,
    provider: hir::Provider,
    library: &str,
    caller: &str,
) -> Option<(String, Vec<String>)> {
    let label = if provider == hir::Provider::ReferenceCounting { "rc" } else { "nogc" };
    let (dir, prepared) = prepare_with_provider(&format!("{name}-{label}"), source, provider)?;
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), library).unwrap();
    std::fs::write(dir.join("caller.c"), caller).unwrap();
    let counted: &[&str] = if provider == hir::Provider::ReferenceCounting { &["-DNTS_PROVIDER_RC"] } else { &[] };
    for file in ["native.c", "caller.c"] {
        clang(&dir, &[&["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file][..], counted].concat());
    }
    clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], counted].concat());
    let mut outputs = Vec::new();
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], counted].concat());
        clang(&dir, &[object, "native.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        let run = Command::new(dir.join(executable)).output().unwrap();
        assert!(run.status.success(), "{name}/{executable}: {}", String::from_utf8_lossy(&run.stderr));
        outputs.push(String::from_utf8_lossy(&run.stdout).trim().to_owned());
    }
    Some((c.writer.text().to_owned(), outputs))
}

/// A caller printing `line`'s values, and under reference counting the live
/// objects `repeat` leaves behind after fifty more runs: ` leak=0` expected.
fn counted_caller(line: &str, repeat: &str) -> String {
    format!(
        "#include \"program.h\"\n#include <stdio.h>\n\
         int main(void) {{\n  {line}\n\
         #ifdef NTS_PROVIDER_RC\n  size_t before = nts_live_count();\n  for (int i = 0; i < 50; i++) {{ {repeat} }}\n\
         \x20 printf(\" leak=%zu\", nts_live_count() - before);\n#endif\n  printf(\"\\n\");\n  return 0;\n}}\n"
    )
}

/// The expected output, with ` leak=0` under reference counting.
fn expect(values: &str, provider: hir::Provider) -> String {
    if provider == hir::Provider::ReferenceCounting { format!("{values} leak=0") } else { values.to_owned() }
}

/// C's array of strings, `char **`, on both backends.
const STRINGS_LIBRARY: &str = r"
#include <stddef.h>
#include <string.h>
int joined(int argc, char **argv) {
    int bytes = 0;
    for (int i = 0; i < argc; i++) bytes += (int)strlen(argv[i]);
    return argv[argc] == NULL ? argc * 1000 + bytes : -1;
}
int maybe(int argc, char **argv) {
    return argv == NULL ? (argc == 0 ? -2 : -3) : joined(argc, argv);
}
int walked(const char *const *values) {
    if (values == NULL) return -1;
    int n = 0, bytes = 0;
    while (values[n] != NULL) bytes += (int)strlen(values[n++]);
    return n * 1000 + bytes;
}
";

/// A `string[]` crosses to C as a NULL-terminated `char **`, lent for the
/// call: `argv`'s shape, and `GLib`'s `gchar **`.
///
/// The empty array is the first case, because it is the one a generated
/// fixture never supplies and the one C contracts split on: it is a table
/// holding only the terminator, not NULL, which a callee walking to the
/// terminator without checking relies on -- and NULL is kept for `null`.
/// Then `null`, UTF-8 that is not ASCII, a length slot C takes *before* the
/// array (`argc`), and a hundred strings. Each answer counts both the strings
/// and their bytes, so a wrong count, a missing terminator or a wrong
/// transcoding each change it.
///
/// And the refusal: without `@ntsNoEscape` the call is refused, because a
/// callee that kept the table would read freed memory and nothing would say
/// so.
#[test]
fn a_string_array_crosses_as_a_null_terminated_char_pointer_array_on_both_backends() {
    let source = r#"
import type { CStrings, Counted, c_int } from "c:types";
/** @ntsNoEscape argv */
declare function joined(argv: Counted<CStrings<"char">, c_int, "before">): c_int;
/** @ntsNoEscape argv */
declare function maybe(argv: Counted<CStrings<"char">, c_int, "before"> | null): c_int;
/** @ntsNoEscape values */
declare function walked(values: CStrings | null): c_int;
export function empty(): number { return walked([]) * 10 + joined([]); }
export function absent(): number { return walked(null) * 10 + maybe(null) + maybe(["q"]) * 100; }
export function text(): number { return walked(["ab", "αβ"]); }
export function counted(): number { return joined(["x", "yz", "😀"]); }
export function many(): number {
    const values: string[] = [];
    for (let i = 0; i < 100; i++) values.push(String(i));
    return joined(values);
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(
            r#"printf("%.0f %.0f %.0f %.0f %.0f", empty(), absent(), text(), counted(), many());"#,
            "empty(); absent(); text(); counted(); many();",
        );
        let Some((text, outputs)) = run_on_both_backends("strings", source, provider, STRINGS_LIBRARY, &caller) else { return; };
        assert!(text.contains("int walked(const char * const *)"), "`CStrings` is not `const char * const *`");
        assert!(text.contains("int joined(int, char * *)"), "the length is not the slot before the array");
        // `absent`: NULL for `null` (-1), `(0, NULL)` for a counted `null`
        // (-2), and a counted array that is present (1001).
        for output in outputs {
            assert_eq!(output, expect("0 100088 2006 3007 100190", provider), "{provider:?}");
        }
    }

    let kept = r#"
import type { CStrings, c_int } from "c:types";
declare function walked(values: CStrings): c_int;
export function run(): number { return walked(["a"]); }
"#;
    let Some((_, prepared)) = prepare("strings-kept", kept) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("a `CStrings` or `CBytes` parameter without `@ntsNoEscape`")),
        "a `CStrings` parameter C may keep was lowered: {:?}",
        prepared.diagnostics
    );
}

/// C returning arrays of strings, one the caller frees and one it borrows.
const RETURNED_STRINGS_LIBRARY: &str = r#"
#include <stdlib.h>
#include <string.h>
static int freed;
static char *copy(const char *text) { char *out = malloc(strlen(text) + 1); strcpy(out, text); return out; }
char **owned(void) {
    char **out = malloc(3 * sizeof *out);
    out[0] = copy("alpha"); out[1] = copy("\xce\xb2" "eta"); out[2] = NULL;
    return out;
}
void owned_free(char **names) { for (char **p = names; *p; p++) free(*p); free(names); freed++; }
int freed_count(void) { return freed; }
static const char *const fixed[] = { "one", NULL };
static const char *const none[] = { NULL };
const char *const *borrowed(int which) { return which == 0 ? NULL : which == 1 ? fixed : none; }
"#;

/// A `string[]` C returns, as the NULL-terminated `char **` it is: each
/// element copied, so the array is the program's, and C's released by the
/// declaration's `@ntsFree` -- which is declared taking `char **`, the
/// array's own type, where a string's free takes `void *`.
///
/// Borrowed unless `@ntsFree` says otherwise, which is the rule a returned
/// `string` follows: `const char * const *` then, `char **` owned. The
/// counter is what shows the free ran exactly once per call, and after the
/// copy -- the copy reads C's array, so the other order reads freed memory.
/// `null` is NULL, and an empty array is an empty array.
#[test]
fn a_returned_string_array_is_copied_and_freed_on_both_backends() {
    let source = r#"
import type { c_int } from "c:types";
/** @ntsFree owned_free */
declare function owned(): string[];
declare function freed_count(): c_int;
declare function borrowed(which: c_int): string[] | null;
export function run(): number {
    const first = owned();
    const second = owned();
    const fixed = borrowed(1 as c_int);
    const none = borrowed(2 as c_int);
    return first.length * 100000 + second[1].length * 10000 + freed_count() * 1000
        + (fixed === null ? 900 : fixed.length * 100 + (fixed[0] === "one" ? 10 : 0))
        + (none === null ? 9 : none.length) + (borrowed(0 as c_int) === null ? 0 : 5000000);
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((text, outputs)) = run_on_both_backends("returned-strings", source, provider, RETURNED_STRINGS_LIBRARY, &caller)
        else {
            return;
        };
        assert!(text.contains("char * * owned(void)"), "an owned array is not `char **`");
        assert!(text.contains("const char * const * borrowed(int)"), "a borrowed array is not `const char * const *`");
        // Two elements; "βeta" is 4 units; freed twice; one borrowed "one";
        // an empty array; NULL for `null`.
        for output in outputs {
            assert_eq!(output, expect("242110", provider), "{provider:?}");
        }
    }
}

/// C reading and writing bytes through a pointer and a length.
const BYTES_LIBRARY: &str = r"
#include <stddef.h>
#include <stdint.h>
int bytes_sum(const uint8_t *data, size_t length) {
    if (data == NULL) return length == 0 ? -1 : -2;
    int sum = 0;
    for (size_t i = 0; i < length; i++) sum += data[i];
    return sum * 100 + (int)length;
}
void bytes_fill(uint8_t *out, int count) { for (int i = 0; i < count; i++) out[i] = (uint8_t)(i * 3); }
";

/// A `Uint8Array` crosses to C as a pointer to its own bytes, borrowed in
/// place for the call: `const guint8 *data` with its length beside it.
///
/// Each arm is a way a copy or a wrong address would show. A `subarray`
/// starts part-way into its buffer, so a pointer to the buffer rather than
/// the view reads the wrong bytes. C writing through `uint8_t *` is read back
/// from the array afterwards, which a copy in would lose. An empty array is a
/// length of 0 at a real address, and `null` is `(NULL, 0)`. And the length
/// is the view's byte length, which C is told and the program never passes.
#[test]
fn a_uint8_array_is_borrowed_in_place_on_both_backends() {
    let source = r#"
import type { CBytes, Counted, c_int, c_size_t } from "c:types";
/** @ntsNoEscape data */
declare function bytes_sum(data: Counted<CBytes, c_size_t> | null): c_int;
/** @ntsNoEscape out */
declare function bytes_fill(out: CBytes<"uint8_t">, count: c_int): void;
export function run(): string {
    const data = new Uint8Array([1, 2, 3, 250]);
    const out = new Uint8Array(5);
    bytes_fill(out, 4 as c_int);
    return [bytes_sum(data), bytes_sum(data.subarray(2)), bytes_sum(new Uint8Array(0)), bytes_sum(null),
        out[1] * 100 + out[3] * 10 + out[4]].join(" ");
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(
            "NtsString *s = run(); for (uint32_t i = 0; i < s->length; i++) putchar((int)nts_unit(s, i));",
            // `run` hands back a string the caller owns.
            "nts_release((NtsHeader *)run());",
        );
        let Some((text, outputs)) = run_on_both_backends("bytes", source, provider, BYTES_LIBRARY, &caller) else { return; };
        assert!(text.contains("int bytes_sum(const uint8_t *, size_t)"), "`CBytes` is not `const uint8_t *` with its length after");
        assert!(text.contains("void bytes_fill(uint8_t *, int)"), "`CBytes<\"uint8_t\">` is not writable");
        for output in outputs {
            assert_eq!(output, expect("25604 25302 0 -1 390", provider), "{provider:?}");
        }
    }
}
