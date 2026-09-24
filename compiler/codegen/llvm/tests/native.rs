//! Native ABI agreement against a separately compiled C implementation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::{fmt::Write, process::Command};

#[path = "../../common/test-support/native_cases.rs"]
mod native_cases;
use native_cases::{CASES, WIDE_CASES, WINDOWS_ONLY};

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

/// What the checker says of `source`, for an arm whose refusal is the
/// checker's rather than lowering's -- which `prepare` asserts never happens.
fn checker_messages(name: &str, source: &str) -> Option<Vec<String>> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
    let dir = root.join(format!("target/native-llvm-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("tsconfig.json"), format!(
        r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"]}}"#
    )).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    Some(snapshot.diagnostics.iter().map(|d| d.message.clone()).collect())
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c_program = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c_program.is_complete(), "{:?}", c_program.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(!c.is_complete());
    assert!(c.diagnostics.iter().any(|d| d.message.contains("abs") && d.message.contains("no declared C ABI")));
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
    let emitted = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let emitted = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert_eq!(
        llvm.text
            .matches("declare i32 @native_identity(i32)")
            .count(),
        1
    );
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("(struct _GtkWidget *)"), "no conversion to the ancestor was emitted");
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("int same(void *, void *)"), "`object` did not become `void *`");
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
                if let hir::OpKind::Retain(value) | hir::OpKind::Release(value) | hir::OpKind::Erase { value, .. } = op.kind {
                    assert!(!matches!(func.values[value.0 as usize].ty, hir::HirType::NativePointer(_)));
                }
            }
        }
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
        let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(c.writer.text().contains("struct _GError * *"), "the error slot's address is not a `GError **`");
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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

/// An ASCII `string` is lent to C in place, not copied: a narrow string's
/// storage is already NUL-terminated, so its bytes *are* the C string.
///
/// Observed by converting one string twice in one call: lent, both arguments
/// are one pointer; copied, they are two allocations alive at once, which can
/// never be equal. Non-ASCII, and a wide string, must still be copies -- the
/// UTF-8 is not the storage -- and under reference counting nothing leaks and
/// nothing is freed that was lent (a `free` of the string's own storage would
/// crash here, or corrupt the heap for the fifty repeats).
#[test]
fn an_ascii_string_is_lent_to_c_in_place_on_both_backends() {
    let source = r#"
import type { c_int } from "c:types";
declare function same(a: string, b: string): boolean;
declare function length(a: string): c_int;
export function ascii(): number { const s = "gtk_label_set_text"; return same(s, s) ? 1 : 0; }
export function latin(): number { const s = "caf\u00e9"; return same(s, s) ? 1 : 0; }
export function wide(): number { const s = "\u03b1\u03b2"; return same(s, s) ? 1 : 0; }
export function built(): number { let s = ""; for (let i = 0; i < 20; i++) s += String(i); return same(s, s) ? length(s) : -1; }
"#;
    let library = r"
#include <stdbool.h>
#include <string.h>
bool same(const char *a, const char *b) { return a == b && strcmp(a, b) == 0; }
int length(const char *a) { return (int)strlen(a); }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(
            r#"printf("%.0f %.0f %.0f %.0f", ascii(), latin(), wide(), built());"#,
            "ascii(); latin(); wide(); built();",
        );
        let Some((_, outputs)) = run_on_both_backends("lent-string", source, provider, library, &caller) else { return; };
        for output in outputs {
            assert_eq!(output, expect("1 0 0 30", provider), "{provider:?}");
        }
    }
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

/// An asynchronous C API in miniature: a start function that keeps the
/// callback and its data, and a loop turn that fires every pending one once.
const ASYNC_LIBRARY: &str = r"
typedef void (*ready_fn)(int result, void *data);
static struct { ready_fn fn; void *data; int value; } pending[8];
static int count;
void start_async(int value, ready_fn fn, void *data) {
    pending[count].fn = fn; pending[count].data = data; pending[count].value = value; count++;
}
void fire_all(void) {
    int n = count;
    count = 0;
    for (int i = 0; i < n; i++) pending[i].fn(pending[i].value * 2, pending[i].data);
}
";

/// A closure C calls once, later, with no destroy function to release it by:
/// GIO's `GAsyncReadyCallback`, which is how an `_async` function reports and
/// what a Promise over it resolves from.
///
/// The closure outlives the call that registered it -- `start` has returned
/// before `fire_all` calls anything -- and captures that call's own `k`, so a
/// closure released at the end of `start` would be read after it was freed.
/// Released after its one call instead: under reference counting, fifty more
/// runs leave `nts_live_count` where it was, which a closure nobody gave back
/// would not. And counted while it is out -- a callback C still owes, which a
/// `GLib` loop turns for: two after two starts, none after they fire.
#[test]
fn a_once_closure_is_released_after_its_one_call_on_both_backends() {
    let source = r"
import type { OnceClosure, c_int } from 'c:types';
declare function start_async(value: c_int, ready: OnceClosure<(result: c_int) => void>): void;
declare function fire_all(): void;
let total = 0;
function start(k: number): void {
    start_async(k as c_int, (result) => { total += result * k; });
}
export function run(): number {
    total = 0;
    start(1);
    start(10);
    fire_all();
    fire_all();
    return total;
}
export function started(): void { start(3); start(4); }
export function fired(): void { fire_all(); }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(
            r#"printf("%.0f", run()); started(); printf(" owed=%zu", nts_closures_owed()); fired(); printf(" then=%zu", nts_closures_owed());"#,
            "run();",
        );
        let Some((text, outputs)) = run_on_both_backends("once", source, provider, ASYNC_LIBRARY, &caller) else { return; };
        assert!(text.contains("NtsBridgeOnce_"), "the bridge does not give the closure back");
        assert!(text.contains("nts_closure_unlend_once(a1)"), "the once-bridge does not release its context");
        // 1 * 2 * 1 + 10 * 2 * 10, each exactly once: a second `fire_all`
        // finds nothing pending.
        for output in outputs {
            assert_eq!(output, expect("202 owed=2 then=0", provider), "{provider:?}");
        }
    }
}

/// A small class hierarchy in C, with functions taking an instance first.
const METHODS_LIBRARY: &str = r#"
#include <stdlib.h>
#include <string.h>
struct _Widget { int width; };
struct _Button { struct _Widget parent; char label[32]; };
static struct _Button the = { { 42 }, "" };
struct _Button *button_new(void) { return &the; }
int widget_get_width(struct _Widget *self) { return self->width; }
void button_set_label(struct _Button *self, const char *label) { strncpy(self->label, label, 31); }
char *button_dup_label(struct _Button *self) { char *out = malloc(strlen(self->label) + 1); strcpy(out, self->label); return out; }
int button_count(struct _Button *self, const char *const *names) { (void)self; int n = 0; while (names[n]) n++; return n; }
"#;

/// A C function declared as a method of the handle it takes first:
/// `button.set_label(text)` is `button_set_label(button, text)`, with no
/// wrapper object and no dispatch -- what `bind-gir` writes for every GIR
/// method, on an `…OwnMethods` interface, with `this: T` for the instance.
///
/// Each arm is a way the lowering could get it wrong: a method declared on
/// the parent (`get_width`, `this: Widget`) called on a `Button`, whose
/// receiver must upcast; a `string` argument, lent and given back; a
/// `CStrings` one, which only a call known to be C's takes as `char **`; and
/// a returned string the caller frees. Under reference counting, fifty more
/// runs leave nothing alive.
#[test]
fn a_c_function_is_a_method_of_the_handle_it_takes_on_both_backends() {
    let source = r#"
import type { Class, CStrings, c_int } from "c:types";
interface WidgetOwnMethods {
    /** @ntsSymbol widget_get_width */
    get_width(this: Widget): c_int;
}
interface ButtonOwnMethods {
    /** @ntsSymbol button_set_label */
    set_label(this: Button, label: string): void;
    /**
     * @ntsFree free
     * @ntsSymbol button_dup_label
     */
    dup_label(this: Button): string;
    /**
     * @ntsNoEscape names
     * @ntsSymbol button_count
     */
    count(this: Button, names: CStrings): c_int;
}
type Widget = Class<"_Widget"> & WidgetOwnMethods;
type Button = Class<"_Button", Widget> & ButtonOwnMethods & WidgetOwnMethods;
declare function button_new(): Button;
export function run(): number {
    const button = button_new();
    button.set_label("héllo");
    return button.get_width() * 1000 + button.dup_label().length * 10 + button.count(["a", "b"]);
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((text, outputs)) = run_on_both_backends("methods", source, provider, METHODS_LIBRARY, &caller) else { return; };
        assert!(text.contains("button_set_label(v"), "the method is not the C function");
        // 42 from the parent's method, "héllo" read back as 5 units, and two
        // names counted to the terminator.
        for output in outputs {
            assert_eq!(output, expect("42052", provider), "{provider:?}");
        }
    }
}

/// An enum C takes as an integer (`CEnum<E, B>`), passed as its members are:
/// no `as c_uint`. A member, a written number and a member of a negative
/// enum through `c_int` each arrive as their value, and a result typed by the
/// enum compares with its members. What the type checks -- another enum's
/// member refused -- is the checker's, and is the `TS2345` arm below. Not a
/// range check: a plain number is accepted, as C accepts one.
#[test]
fn an_enum_crosses_to_c_as_its_integer_on_both_backends() {
    let source = r#"
import type { CEnum, c_int, c_uint } from "c:types";
declare const enum Orientation { HORIZONTAL = 0, VERTICAL = 1 }
declare const enum Sign { NEGATIVE = -3, POSITIVE = 5 }
declare function orient(orientation: CEnum<Orientation, c_uint>, spacing: c_int): c_int;
declare function signed_of(sign: CEnum<Sign, c_int>): c_int;
declare function flipped(orientation: CEnum<Orientation, c_uint>): CEnum<Orientation, c_uint>;
/** @ntsDefault orientation=1 */
declare function orient_last(spacing: c_int, orientation?: CEnum<Orientation, c_uint>): c_int;
export function run(): number {
    const n: number = 1;
    return orient(Orientation.VERTICAL, 4 as c_int) * 1000
        + orient(n, 2 as c_int) * 100
        + signed_of(Sign.NEGATIVE) * 10
        + (flipped(Orientation.VERTICAL) === Orientation.HORIZONTAL ? 1 : 0);
}
// An enum parameter left out, `@ntsDefault`: optional, it is its members and
// `undefined` in one union. VERTICAL, 1, beside a written HORIZONTAL.
export function defaulted(): number { return orient_last(3 as c_int) * 100 + orient_last(3 as c_int, Orientation.HORIZONTAL); }
"#;
    let library = r"
int orient(unsigned orientation, int spacing) { return (int)orientation * 10 + spacing; }
int signed_of(int sign) { return sign; }
unsigned flipped(unsigned orientation) { return orientation ^ 1u; }
int orient_last(int spacing, unsigned orientation) { return (int)orientation * 10 + spacing; }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f %.0f", run(), defaulted());"#, "run(); defaulted();");
        let Some((text, outputs)) = run_on_both_backends("enums", source, provider, library, &caller) else { return; };
        assert!(text.contains("int orient(unsigned int, int)"), "the enum is not C's unsigned int");
        assert!(text.contains("int signed_of(int)"), "the signed enum is not C's int");
        // 14 * 1000, 12 * 100, -3 * 10, and the flipped member compared.
        for output in outputs {
            // And 13 with the default, 3 with HORIZONTAL written.
            assert_eq!(output, expect("15171 1303", provider), "{provider:?}");
        }
    }
    let other = source.replace("orient(n, 2 as c_int)", "orient(Sign.POSITIVE, 2 as c_int)");
    let Some(messages) = checker_messages("enums-other", &other) else { return; };
    assert!(
        messages.iter().any(|m| m.contains("'Sign.POSITIVE' is not assignable to parameter of type 'CEnum<Orientation, c_uint>'")),
        "another enum's member was accepted: {messages:?}"
    );
}

/// A fake `GObject` for the counting tests: the real pair's signatures, a
/// count, and a `freed` flag instead of `free`, so a use after the last
/// release reads -1 rather than whatever the allocator left.
const GOBJECT_LIBRARY: &str = r"
#include <stdbool.h>
#include <stdlib.h>
typedef struct _GTypeInstance { int type; } GTypeInstance;
typedef struct _GObject { GTypeInstance instance; int refs; bool floating; bool freed; } GObject;
typedef struct _Thing { GObject parent; int value; } Thing;
static int live;
static Thing *thing(int value, bool floating) {
    Thing *t = calloc(1, sizeof *t);
    t->parent.refs = 1;
    t->parent.floating = floating;
    t->value = value;
    live++;
    return t;
}
struct _Thing *thing_new_owned(int value) { return thing(value, false); }
struct _Thing *thing_new_floating(int value) { return thing(value, true); }
static int errors;
/* As GLib's: NULL is a critical, counted here rather than aborting. */
void *g_object_ref_sink(void *object) {
    GObject *o = object;
    if (!o) { errors++; return object; }
    if (o->floating) o->floating = false; else o->refs++;
    return object;
}
void g_object_unref(void *object) {
    GObject *o = object;
    if (!o || o->freed || o->refs <= 0) { errors++; return; }
    if (--o->refs == 0) { o->freed = true; live--; }
}
static Thing *kept;
void thing_keep(struct _Thing *t) { if (kept) g_object_unref(kept); kept = t; }
void thing_drop_kept(void) { if (kept) { g_object_unref(kept); kept = NULL; } }
int errors_seen(void) { return errors; }
int instance_value(struct _GTypeInstance *instance) {
    Thing *t = (Thing *)instance;
    return t->parent.freed ? -1 : t->value;
}
int live_objects(void) { return live; }
";

/// `GObjectClass`, counted with `g_object_ref_sink`/`g_object_unref` under
/// reference counting, and seen by C as the `GTypeInstance` it starts with.
///
/// Each arm is a way the count could be wrong. A `GTypeInstance` view held
/// past a branch: the view holds no reference, and the object's own last use
/// is the conversion, so without the ownership pass keeping the object alive
/// across the view it is released on the edge into the branch and the view
/// reads -1 there. (A view used within its own block does not show it:
/// releases there fall after the block's last use either way.) A fresh +1
/// temporary passed straight to such a parameter; a transfer-none result born
/// floating, which `ref_sink` takes and the last use drops; and one object
/// held twice. After fifty runs of each, nothing is alive.
#[test]
fn a_gobject_is_counted_and_seen_by_c_as_its_instance_on_both_backends() {
    let source = r#"
import type { Class, GObjectClass, Owned, c_int } from "c:types";
type GTypeInstance = Class<"_GTypeInstance">;
type GObject = GObjectClass<"_GObject", GTypeInstance>;
type Thing = GObjectClass<"_Thing", GObject>;
declare function thing_new_owned(value: c_int): Owned<Thing>;
declare function thing_new_floating(value: c_int): Thing;
declare function instance_value(instance: GTypeInstance): c_int;
declare function live_objects(): c_int;
export function temporary(): number { return instance_value(thing_new_owned(7 as c_int)); }
export function floating(): number { const t = thing_new_floating(5 as c_int); return instance_value(t); }
export function twice(): number { const a = thing_new_owned(3 as c_int); const b = a; return instance_value(b) + instance_value(a); }
export function branched(flag: boolean): number {
    const instance: GTypeInstance = thing_new_owned(9 as c_int);
    if (flag) {
        return instance_value(instance);
    }
    return 0;
}
export function live(): number { return live_objects(); }
"#;
    let caller = counted_caller(
        r#"printf("%.0f %.0f %.0f %.0f", branched(true), temporary(), floating(), twice());
  for (int i = 0; i < 50; i++) { branched(true); branched(false); temporary(); floating(); twice(); }
  printf(" live=%.0f", live());"#,
        "",
    );
    let Some((_, outputs)) =
        run_on_both_backends("gobject", source, hir::Provider::ReferenceCounting, GOBJECT_LIBRARY, &caller)
    else {
        return;
    };
    for output in outputs {
        assert_eq!(output, "9 7 5 6 live=0 leak=0");
    }
}

/// A promise of a counted `GObject`: `await file.query_info_async(…)` under
/// reference counting. The promise's own slot for a C handle holds no
/// reference, so a counted one settles boxed -- an ordinary reference whose
/// one field is the handle -- and the `await` reads it back out. Each handle
/// is +1 from C, held across later awaits, read through, and dropped: fifty
/// runs leave nothing alive and no unref of a freed object. The one it
/// replaced left the promise a freed object the moment the settle returned.
#[test]
fn a_promise_of_a_gobject_holds_a_reference_on_both_backends() {
    let source = r#"
import type { Class, GObjectClass, Owned, c_int } from "c:types";
type GTypeInstance = Class<"_GTypeInstance">;
type GObject = GObjectClass<"_GObject", GTypeInstance>;
type Thing = GObjectClass<"_Thing", GObject>;
declare function thing_new_owned(value: c_int): Owned<Thing>;
declare function instance_value(instance: GTypeInstance): c_int;
declare function live_objects(): c_int;
declare function errors_seen(): c_int;
let total = 0;
async function later(value: number): Promise<Thing> {
    return thing_new_owned(value as c_int);
}
async function use(): Promise<void> {
    const first = await later(4);
    const second = await later(2);
    const third = await later(7);
    total = (instance_value(first) as number) * 100 + (instance_value(second) as number) * 10 + (instance_value(third) as number);
}
export function start(): void {
    total = 0;
    void use();
}
export function settled(): number { return total; }
export function live(): number { return live_objects(); }
export function errors(): number { return errors_seen(); }
"#;
    let caller = counted_caller(
        r#"start(); nts_checkpoint(); printf("%.0f", settled());
  for (int i = 0; i < 50; i++) { start(); nts_checkpoint(); }
  printf(" live=%.0f errors=%.0f", live(), errors());"#,
        "",
    );
    let Some((text, outputs)) =
        run_on_both_backends("promised-gobject", source, hir::Provider::ReferenceCounting, GOBJECT_LIBRARY, &caller)
    else {
        return;
    };
    assert!(text.contains("HandleBoxGObject"), "the handle did not settle boxed");
    for output in outputs {
        assert_eq!(output, "427 live=0 errors=0 leak=0");
    }
}

/// `Consumed<T>`: an argument C keeps (GIR's `transfer-ownership="full"`),
/// so the caller hands a reference over instead of releasing its own after
/// the call. A +1 temporary is handed as it is; a variable still used after
/// the call, or a borrowed (+0, floating) result, needs a reference taken
/// for it first. Each is dropped by C later, and the count balances: an
/// extra release would be an unref of a freed object, which the fake counts
/// as an error, and a missing one leaves the object alive.
#[test]
fn a_consumed_argument_is_handed_over_on_both_backends() {
    let source = r#"
import type { Class, Consumed, GObjectClass, Owned, c_int } from "c:types";
type GTypeInstance = Class<"_GTypeInstance">;
type GObject = GObjectClass<"_GObject", GTypeInstance>;
type Thing = GObjectClass<"_Thing", GObject>;
declare function thing_new_owned(value: c_int): Owned<Thing>;
declare function thing_new_floating(value: c_int): Thing;
declare function thing_keep(thing: Consumed<Thing>): void;
declare function thing_drop_kept(): void;
declare function instance_value(instance: GTypeInstance): c_int;
declare function live_objects(): c_int;
declare function errors_seen(): c_int;
export function temporary(): void { thing_keep(thing_new_owned(4 as c_int)); thing_drop_kept(); }
export function used_after(): number {
    const t = thing_new_owned(5 as c_int);
    thing_keep(t);
    thing_drop_kept();
    return instance_value(t);
}
export function floating(): void { thing_keep(thing_new_floating(6 as c_int)); thing_drop_kept(); }
export function live(): number { return live_objects(); }
export function errors(): number { return errors_seen(); }
"#;
    let caller = counted_caller(
        r#"temporary(); printf("%.0f", used_after()); floating();
  for (int i = 0; i < 50; i++) { temporary(); used_after(); floating(); }
  printf(" live=%.0f errors=%.0f", live(), errors());"#,
        "",
    );
    let Some((_, outputs)) =
        run_on_both_backends("consumed", source, hir::Provider::ReferenceCounting, GOBJECT_LIBRARY, &caller)
    else {
        return;
    };
    for output in outputs {
        assert_eq!(output, "5 live=0 errors=0 leak=0");
    }
}

/// A binding's property on a handle (`@ntsGet`/`@ntsSet`): GJS's `label.text`
/// and `label.text = t`, each the call to the method its tag names. A string
/// is lent and copied back through the methods' own roles, a boolean crosses
/// as C's `bool`, and an assignment is still the value it assigned. A read of
/// a property with no `@ntsGet` is refused by name.
#[test]
fn a_native_property_reads_and_writes_through_its_methods_on_both_backends() {
    let source = r#"
import type { Class, c_int } from "c:types";
interface LabelOwnMethods {
    /** @ntsSymbol label_get_text */
    get_text(this: Label): string;
    /** @ntsSymbol label_set_text */
    set_text(this: Label, text: string): void;
    /** @ntsSymbol label_get_visible */
    get_visible(this: Label): boolean;
    /** @ntsSymbol label_set_visible */
    set_visible(this: Label, visible: boolean): void;
    /** @ntsSymbol label_set_width */
    set_width(this: Label, width: c_int): void;
    /**
     * @ntsGet get_text
     * @ntsSet set_text
     */
    text: string;
    /**
     * @ntsGet get_visible
     * @ntsSet set_visible
     */
    visible: boolean;
    /** @ntsSet set_width */
    width: c_int;
}
type Label = Class<"_Label"> & LabelOwnMethods;
declare function label_new(): Label;
declare function label_width(label: Label): c_int;
export function run(): number {
    const label = label_new();
    label.text = "h\u00e9llo";
    const read = label.text;
    label.visible = true;
    const on = label.visible ? 1 : 0;
    label.visible = false;
    const assigned = (label.text = "ab");
    label.width = 7 as c_int;
    return read.length * 10000 + on * 1000 + (label.visible ? 100 : 0) + assigned.length * 10 + (label_width(label) as number);
}
"#;
    let library = r"
#include <stdbool.h>
#include <string.h>
struct _Label { char text[32]; bool visible; int width; };
static struct _Label the;
struct _Label *label_new(void) { return &the; }
const char *label_get_text(struct _Label *self) { return self->text; }
void label_set_text(struct _Label *self, const char *text) { strncpy(self->text, text, 31); }
bool label_get_visible(struct _Label *self) { return self->visible; }
void label_set_visible(struct _Label *self, bool visible) { self->visible = visible; }
void label_set_width(struct _Label *self, int width) { self->width = width; }
int label_width(struct _Label *self) { return self->width; }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((text, outputs)) = run_on_both_backends("accessors", source, provider, library, &caller) else { return; };
        assert!(text.contains("label_set_text("), "the write is not the setter");
        // "héllo" read back (5), `true` read back, `false` after, "ab" as the
        // assignment's value, and 7 written through a set-only property.
        for output in outputs {
            assert_eq!(output, expect("51027", provider), "{provider:?}");
        }
    }
    let unreadable = source.replace("(label_width(label) as number)", "(label.width as number)");
    let Some((_, prepared)) = prepare("accessors-unreadable", &unreadable) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("a read of a native property no @ntsGet names a method for")),
        "a set-only property was read: {:?}",
        prepared.diagnostics
    );
}

/// `CBool<B>`: `GLib`'s `gboolean`, a C `int` the program reads and writes as
/// a boolean. `true` and `false` arrive as 1 and 0; a C answer of 2 -- which
/// C calls true -- is `true`, which a truncating conversion would read as
/// `false` (2's low bit is 0); and an optional one takes its `@ntsDefault`.
/// A callback's too, `GSourceFunc`'s shape: C's 2 arrives as `true`, and what
/// the callback answers reaches C as exactly 1 or 0.
#[test]
fn a_c_int_boolean_crosses_as_a_boolean_on_both_backends() {
    let source = r#"
import type { CBool, c_int } from "c:types";
declare function remember(on: CBool<c_int>): void;
declare function remembered(): c_int;
declare function two(): CBool<c_int>;
declare function zero(): CBool<c_int>;
/** @ntsDefault on=1 */
declare function toggle(on?: CBool<c_int>): CBool<c_int>;
export function run(): number {
    remember(true);
    const was_true = remembered() as number;
    remember(false);
    const was_false = remembered() as number;
    return was_true * 10000 + was_false * 1000 + (two() ? 100 : 0) + (zero() ? 1 : 0) * 10 + (toggle() && !toggle(false) ? 1 : 0);
}
// `false | CBool<c_int>`, as `value !== null && is_a(value, type)` is typed:
// a value, not a call's result, which has to represent as a boolean too.
function both(flag: boolean): boolean { return flag && two(); }
export function narrowed(): number { return (both(true) ? 10 : 0) + (both(false) ? 1 : 0); }
declare function ask(callback: (flag: CBool<c_int>) => CBool<c_int>): c_int;
function negate(flag: boolean): boolean { return !flag; }
export function asked(): number { return ask(negate) as number; }
"#;
    let library = r"
static int held = -1;
void remember(int on) { held = on; }
int remembered(void) { return held; }
int two(void) { return 2; }
int zero(void) { return 0; }
int toggle(int on) { return on; }
int ask(int (*callback)(int)) { return (callback(2) == 0) * 10 + (callback(0) == 1); }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f %.0f %.0f", run(), narrowed(), asked());"#, "run(); narrowed(); asked();");
        let Some((text, outputs)) = run_on_both_backends("cbool", source, provider, library, &caller) else { return; };
        assert!(text.contains("void remember(int)"), "a `CBool<c_int>` is not C's int");
        // 1 and 0 arrive; 2 is true; 0 is false; the default is true and a
        // written `false` is false; the callback reads 2 as true and answers
        // 0 for it, and 1 for 0.
        for output in outputs {
            assert_eq!(output, expect("10101 10 11", provider), "{provider:?}");
        }
    }
}

/// GJS's construction, `new GtkButton({ label, width })`: the constructor
/// `@ntsConstruct` names, then one setter per property the literal writes, in
/// the literal's order and after its values are evaluated in that order --
/// the fake records every setter call, so an order taken from the type rather
/// than the literal, a property written that was not, or a value evaluated
/// twice all change the record. A literal naming one property twice is
/// TypeScript's own error (TS1117), so it has no arm. A props bag that is not
/// a literal is refused by name.
///
/// `Other` is made by its type, as a class with no `new` taking nothing is:
/// `@ntsConstruct thing_construct thing_get_type` passes the `GType`-like
/// value straight to the constructor, whose other parameter is defaulted.
/// The value needs all 64 bits, so a trip through a double reads as 9.
#[test]
fn a_handle_is_constructed_with_properties_on_both_backends() {
    let source = r#"
import type { Class, c_int, c_size_t } from "c:types";
interface ThingOwnMethods {
    /** @ntsSymbol thing_set_label */
    set_label(this: Thing, label: string): void;
    /** @ntsSymbol thing_set_width */
    set_width(this: Thing, width: c_int): void;
    /** @ntsSymbol thing_set_height */
    set_height(this: Thing, height: c_int): void;
    /** @ntsSet set_label */
    label: string;
    /** @ntsSet set_width */
    width: c_int;
    /** @ntsSet set_height */
    height: c_int;
}
type Thing = Class<"_Thing"> & ThingOwnMethods;
interface ThingProps { label?: string; width?: c_int; height?: c_int }
declare function thing_new(): Thing;
declare const Thing: {
    /** @ntsConstruct thing_new */
    new (props?: ThingProps): Thing;
};
declare function thing_record(thing: Thing): c_int;
declare function thing_get_type(): c_size_t;
/** @ntsDefault spare=0 */
declare function thing_construct(type: c_size_t, spare?: c_int): Thing;
declare const Other: {
    /** @ntsConstruct thing_construct thing_get_type */
    new (props?: ThingProps): Thing;
};
let evaluated = 0;
function next(): c_int { evaluated = evaluated * 10 + 1; return evaluated as c_int; }
export function run(): number {
    const label = "ab";
    // Written width first, then label: the type declares label first.
    const thing = new Thing({ width: next(), label, });
    const plain = new Thing();
    const other = new Other({ height: 5 as c_int });
    return ((thing_record(thing) as number) * 10 + (thing_record(plain) as number)) * 100 + (thing_record(other) as number);
}
"#;
    let library = r"
#include <string.h>
typedef struct _Thing { int record; } Thing;
#include <stddef.h>
static Thing things[3];
static int made;
struct _Thing *thing_new(void) { Thing *t = &things[made++ % 3]; t->record = 0; return t; }
size_t thing_get_type(void) { return (size_t)0x8000000000000001ULL; }
struct _Thing *thing_construct(size_t type, int spare) {
    Thing *t = thing_new();
    t->record = type == (size_t)0x8000000000000001ULL && spare == 0 ? 7 : 9;
    return t;
}
void thing_set_label(struct _Thing *t, const char *label) { t->record = t->record * 10 + 1 + (int)strlen(label) * 0; }
void thing_set_width(struct _Thing *t, int width) { t->record = t->record * 10 + 2 + width * 0; t->record = t->record * 10 + width; }
void thing_set_height(struct _Thing *t, int height) { t->record = t->record * 10 + 3 + height * 0; }
int thing_record(struct _Thing *t) { return t->record; }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((c, outputs)) = run_on_both_backends("construct", source, provider, library, &caller) else { return; };
        // And not by luck of the constant: the type reaches C with no double
        // between, which an exact round trip of a smaller value would hide.
        let typed = c
            .lines()
            .find_map(|line| line.trim().strip_suffix(" = thing_get_type();"))
            .expect("thing_get_type is called");
        assert!(!c.contains(&format!("(double){typed};")), "the type went through a double:\n{c}");
        // width (2, then its value 1), then label (1), and no height: 211;
        // the plain one set nothing: 0; the other was made by its type (7)
        // and given a height (3): 73.
        for output in outputs {
            assert_eq!(output, expect("211073", provider), "{provider:?}");
        }
    }
    let bag = source.replace("new Thing({ width: next(), label, })", "new Thing(({ width: next(), label } as ThingProps))");
    let Some((_, prepared)) = prepare("construct-bag", &bag) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("not written as an object literal")),
        "a props bag that is not a literal was accepted: {:?}",
        prepared.diagnostics
    );
}

/// C behind the `@ntsDefault` test: each answer spells what arrived.
const DEFAULTS_LIBRARY: &str = r"
#include <stdbool.h>
#include <stdlib.h>
typedef struct _Thing { int count; } Thing;
int flagged(int value, unsigned flags) { return value * 100 + (int)flags; }
int toggled(bool on) { return on ? 11 : 22; }
int maybe_thing(Thing *thing) { return thing == NULL ? -1 : 1; }
Thing *thing_new(void) { static Thing thing = { 10 }; return &thing; }
int thing_add(Thing *thing, int amount) { return thing->count + amount; }
";

/// `@ntsDefault`: an optional parameter the caller leaves out reaches C as the
/// value the binding declares.
///
/// The defaults are distinctive -- 7, not 0 -- because a zero default cannot
/// tell "applied" from "never written": both are the same bytes. So each
/// omitted arm is beside a written one that differs from it, a written `0`
/// against the default 7, and a zero default of its own. `null` can only be
/// observed as `NULL`, so that arm stands on the integer arms' evidence that
/// the mechanism runs. And the default is found for the right call: a method,
/// whose receiver is a C argument nobody wrote, and a foreign call nested in
/// another's argument, which must not leave its own function behind.
#[test]
fn an_omitted_argument_takes_the_bindings_default_on_both_backends() {
    let source = r#"
import type { Class, c_int, c_uint } from "c:types";
interface ThingOwnMethods {
    /**
     * @ntsSymbol thing_add
     * @ntsDefault amount=7
     */
    add(this: Thing, amount?: c_int): c_int;
}
type Thing = Class<"_Thing"> & ThingOwnMethods;
/** @ntsDefault flags=7 */
declare function flagged(value: c_int, flags?: c_uint): c_int;
/**
 * @ntsSymbol flagged
 * @ntsDefault flags=0
 */
declare function zeroed(value: c_int, flags?: c_uint): c_int;
/** @ntsDefault on=1 */
declare function toggled(on?: boolean): c_int;
/** @ntsDefault thing=null */
declare function maybe_thing(thing?: Thing | null): c_int;
declare function thing_new(): Thing;
function show(values: number[]): string { return values.join(" "); }
export function run(): string {
    const thing = thing_new();
    return show([
        flagged(3 as c_int), flagged(3 as c_int, 2 as c_uint), flagged(3 as c_int, 0 as c_uint), zeroed(3 as c_int),
        toggled(), toggled(false),
        maybe_thing(), maybe_thing(thing),
        thing.add(), thing.add(5 as c_int),
        flagged(flagged(1 as c_int)),
    ]);
}
export function total(): number { return flagged(1 as c_int) + thing_new().add(); }
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", total());"#, "total();");
        let Some((text, outputs)) = run_on_both_backends("defaults", source, provider, DEFAULTS_LIBRARY, &caller) else { return; };
        assert!(text.contains("flagged("), "the call is not in the C program");
        // 107 and the method's 17.
        for output in outputs {
            assert_eq!(output, expect("124", provider), "{provider:?}");
        }
    }
    // Every arm, as text: the defaults 7, 1, NULL and the method's 7 beside
    // the written 2, 0, false, a handle and 5; and 10707, the outer call's 7
    // after an inner call that took its own.
    let caller = "#include \"program.h\"\n#include <stdio.h>\nint main(void) { NtsString *s = run(); for (uint32_t i = 0; i < s->length; i++) putchar((int)nts_unit(s, i)); putchar('\\n'); return 0; }\n";
    let Some((_, outputs)) = run_on_both_backends("defaults-arms", source, hir::Provider::NoGc, DEFAULTS_LIBRARY, caller) else { return; };
    for output in outputs {
        assert_eq!(output, "307 302 300 300 11 22 -1 1 17 15 10707");
    }

    // What a default cannot be given to, each refused with its reason.
    for (label, declaration, reason) in [
        ("misnamed", "/** @ntsDefault flag=7 */\ndeclare function f(value: c_int, flags?: c_uint): c_int;", "@ntsDefault names no parameter `flag`"),
        ("required", "/** @ntsDefault value=7 */\ndeclare function f(value: c_int, flags?: c_uint): c_int;", "@ntsDefault for `value`, which is not optional"),
        ("absent", "declare function f(value: c_int, flags?: c_uint): c_int;", "optional parameter `flags` that no @ntsDefault gives a value"),
        ("string", "/** @ntsDefault flags=null */\ndeclare function f(value: c_int, flags?: string | null): c_int;", "gives `flags` null, which only a C pointer parameter"),
        ("range", "/** @ntsDefault flags=-1 */\ndeclare function f(value: c_int, flags?: c_uint): c_int;", "gives `flags` -1, outside its C type"),
        ("malformed", "/** @ntsDefault flags */\ndeclare function f(value: c_int, flags?: c_uint): c_int;", "`flags` that is not `parameter=value`"),
    ] {
        let refused = format!(
            "import type {{ c_int, c_uint }} from \"c:types\";\n{declaration}\nexport function run(): number {{ return f(1 as c_int); }}\n"
        );
        let Some((_, prepared)) = prepare(&format!("defaults-{label}"), &refused) else { return; };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(reason)),
            "{label}: {:?}",
            prepared.diagnostics
        );
    }
}

/// A result C declares as an ancestor, typed as what it is: GIR's
/// `gtk_box_new` returns a `GtkBox` the header declares `GtkWidget *`, and
/// `Declared<Button, Widget>` lets the program have the `Button` while the
/// prototype says `Widget`. The value is used through a method only a
/// `Button` has, and its label read back, so a conversion that lost it
/// would read the wrong struct; and a claim off the chain is refused.
///
/// The arm this cannot have: a claim well shaped and false -- a function
/// declared to return a `Button` that returns some other `Widget`. Nothing
/// can know that; the claim is trusted, and wrong GIR is not caught here.
#[test]
fn a_declared_result_is_the_handle_the_binding_says_on_both_backends() {
    let source = r#"
import type { Class, Declared, c_int } from "c:types";
interface WidgetOwnMethods {
    /** @ntsSymbol widget_get_width */
    get_width(this: Widget): c_int;
}
interface ButtonOwnMethods {
    /** @ntsSymbol button_set_label */
    set_label(this: Button, label: string): void;
    /**
     * @ntsFree free
     * @ntsSymbol button_dup_label
     */
    dup_label(this: Button): string;
}
type Widget = Class<"_Widget"> & WidgetOwnMethods;
type Button = Class<"_Button", Widget> & ButtonOwnMethods & WidgetOwnMethods;
declare function button_as_widget(): Declared<Button, Widget>;
declare function maybe_button(which: c_int): Declared<Button, Widget> | null;
export function run(): number {
    const button = button_as_widget();
    button.set_label("declared");
    return button.get_width() * 100 + button.dup_label().length;
}
// Nullable, as 39 of GTK's constructors are: NULL is null, and a handle
// is the `Button` as before.
export function maybe(): number {
    const none = maybe_button(0 as c_int);
    const some = maybe_button(1 as c_int);
    return (none === null ? 1 : 0) * 10 + (some === null ? 0 : some.dup_label().length);
}
"#;
    let library = format!(
        "{METHODS_LIBRARY}struct _Widget *button_as_widget(void) {{ return &the.parent; }}\n\
         struct _Widget *maybe_button(int which) {{ return which ? &the.parent : NULL; }}\n"
    );
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f %.0f", run(), maybe());"#, "run(); maybe();");
        let Some((text, outputs)) = run_on_both_backends("declared", source, provider, &library, &caller) else { return; };
        // What each prototype says is the only observable here: C's two
        // translation units agree on the address whatever either declares.
        for prototype in ["button_as_widget(void)", "maybe_button(int)"] {
            assert!(
                text.contains(&format!("struct _Widget * {prototype}")) || text.contains(&format!("struct _Widget *{prototype}")),
                "`{prototype}` is not declared as C declares it: {text}"
            );
        }
        // 42, and "declared" read back through the `Button`; then null, and
        // the label again through a nullable one.
        for output in outputs {
            assert_eq!(output, expect("4208 18", provider), "{provider:?}");
        }
    }
    let lie = source.replace("button_as_widget(): Declared<Button, Widget>", "button_as_widget(): Declared<Widget, Button>").replace(
        "    const button = button_as_widget();\n    button.set_label(\"declared\");\n    return button.get_width() * 100 + button.dup_label().length;",
        "    return button_as_widget().get_width();",
    );
    let Some((_, prepared)) = prepare("declared-lie", &lie) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("declares its result `_Button` for a `_Widget`, which is not among its ancestors")),
        "a result declared off the chain was accepted: {:?}",
        prepared.diagnostics
    );
}

/// A C API that reports failure through an out-parameter, `GLib`'s way, with a
/// converter that takes the error and answers its message.
const THROWS_LIBRARY: &str = r#"
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
typedef struct _Err { int code; char *message; } Err;
static char *copy(const char *text) { char *out = malloc(strlen(text) + 1); strcpy(out, text); return out; }
int parse_number(const char *text, Err **error) {
    int value = 0;
    for (const char *p = text; *p; p++) {
        if (!isdigit((unsigned char)*p)) {
            if (error) {
                *error = malloc(sizeof **error);
                (*error)->code = 1;
                (*error)->message = malloc(strlen(text) + 16);
                strcpy((*error)->message, "not a number: ");
                strcat((*error)->message, text);
            }
            return -1;
        }
        value = value * 10 + (*p - '0');
    }
    return value;
}
typedef struct _Parser { int base; } Parser;
static Parser the_parser = { 1000000 };
Parser *parser_new(void) { return &the_parser; }
int parser_parse(Parser *self, const char *text, Err **error) {
    int value = parse_number(text, error);
    return value < 0 ? value : self->base + value;
}
char *describe(const char *text, Err **error) {
    if (parse_number(text, error) < 0) return NULL;
    char *out = malloc(strlen(text) + 7);
    strcpy(out, "value ");
    strcat(out, text);
    return out;
}
char *err_take_message(Err *error) {
    char *message = copy(error->message);
    free(error->message);
    free(error);
    return message;
}
"#;

/// `@ntsThrows`: a failure C reports through `Err **error` is thrown as an
/// `Error` carrying the message the declaration's converter makes of it --
/// `GLib`'s `GError **`, with `nts_gerror_take_message`, in `bind-gir`'s
/// output -- when the caller leaves the parameter out.
///
/// The arms: a call that succeeds and throws nothing; one that fails, caught
/// with the converter's message; one whose caller passes its own slot, which
/// is theirs to read and throws nothing -- for a function and for a *method*,
/// whose receiver shifts the argument count; and a string-returning one that
/// fails, whose NULL result must not be read before the failure is thrown. Under reference counting the
/// thrown `Error`s are collected: fifty more runs leave nothing alive.
#[test]
fn a_reported_c_error_is_thrown_on_both_backends() {
    let source = r#"
import type { Class, Ptr, c_int } from "c:types";
import { local } from "c:memory";
type Err = Class<"_Err">;
/**
 * @ntsNoEscape error
 * @ntsThrows error err_take_message
 */
declare function parse_number(text: string, error?: Ptr<Err | null> | null): c_int;
interface ParserOwnMethods {
    /**
     * @ntsNoEscape error
     * @ntsSymbol parser_parse
     * @ntsThrows error err_take_message
     */
    parse(this: Parser, text: string, error?: Ptr<Err | null> | null): c_int;
}
type Parser = Class<"_Parser"> & ParserOwnMethods;
declare function parser_new(): Parser;
/**
 * @ntsFree free
 * @ntsNoEscape error
 * @ntsThrows error err_take_message
 */
declare function describe(text: string, error?: Ptr<Err | null> | null): string;
export function run(): number {
    let total = parse_number("12") as number;
    try {
        parse_number("x1");
        total += 100000000;
    } catch (e) {
        total += (e as Error).message.length * 100;
    }
    const slot = local<Err | null>();
    parse_number("zz", slot);
    total += slot[0] !== null ? 5 : 0;
    // A method: the caller's own slot is theirs -- written, nothing thrown --
    // and leaving it out throws.
    const parser = parser_new();
    const mine = local<Err | null>();
    parser.parse("q", mine);
    total += mine[0] !== null ? 50 : 100000000;
    try {
        parser.parse("q");
        total += 100000000;
    } catch {
        total += 500;
    }
    // A string result: failing, C returns NULL where it promised a string,
    // and the failure is thrown before that NULL is read; succeeding, the
    // string is read as usual.
    try {
        describe("x1");
        total += 100000000;
    } catch {
        total += 7000;
    }
    return total + describe("12").length * 10000;
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((_, outputs)) = run_on_both_backends("throws", source, provider, THROWS_LIBRARY, &caller) else { return; };
        // 12; "not a number: x1" (16) caught; the caller's own slot written,
        // nothing thrown; the same for a method's; a method without one
        // thrown; a failing string result thrown rather than read; and a
        // succeeding one, "value 12", read.
        for output in outputs {
            assert_eq!(output, expect("89167", provider), "{provider:?}");
        }
    }

    // A tag naming no parameter would leave the call with no slot, and every
    // failure unreported: refused.
    let misnamed = r#"
import type { Class, Ptr, c_int } from "c:types";
type Err = Class<"_Err">;
/**
 * @ntsNoEscape error
 * @ntsThrows err err_take_message
 */
declare function parse_number(text: string, error?: Ptr<Err | null> | null): c_int;
export function run(): number { return parse_number("1"); }
"#;
    let Some((_, prepared)) = prepare("throws-misnamed", misnamed) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("@ntsThrows names no parameter `err`")),
        "an @ntsThrows naming no parameter was accepted: {:?}",
        prepared.diagnostics
    );
}

/// A method a binding declares on a handle whose body is the program's own:
/// `@ntsCall` names the function, and a call passes the receiver first. How
/// `bind-gir` gives an `_async` method its Promise form, bodied by a wrapper
/// in the companion module.
///
/// The receiver arrives as the function's first argument -- a `Button`,
/// where the method is declared -- and the body calls one of the handle's C
/// methods on it, so a receiver passed wrongly reads the wrong width. A
/// string argument passes through as it would to any function. And an
/// argument left out takes the *function's* default -- the method in the
/// binding has none, being a declaration -- 7 where written 3, and a `null`
/// beside it, which is how a Promise form leaves out flags and cancellable.
#[test]
fn an_ntscall_method_is_the_programs_function_with_the_receiver_first_on_both_backends() {
    let source = r#"
import type { Class, c_int } from "c:types";
interface WidgetOwnMethods {
    /** @ntsSymbol widget_get_width */
    get_width(this: Widget): c_int;
}
interface ButtonOwnMethods {
    /** @ntsCall labelled_width */
    labelled(this: Button, label: string): number;
    /** @ntsCall scaled_width */
    scaled(this: Button, by?: c_int, other?: Button | null): number;
}
type Widget = Class<"_Widget"> & WidgetOwnMethods;
type Button = Class<"_Button", Widget> & ButtonOwnMethods & WidgetOwnMethods;
declare function button_new(): Button;
function labelled_width(button: Button, label: string): number {
    return (button.get_width() as number) * 100 + label.length;
}
function scaled_width(button: Button, by: c_int = 7 as c_int, other: Button | null = null): number {
    return (button.get_width() as number) * (by as number) + (other === null ? 0 : 1);
}
export function run(): number {
    const button = button_new();
    return button.labelled("héllo") * 100000 + button.scaled() * 1000 + button.scaled(3 as c_int, button);
}
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
        let Some((_, outputs)) = run_on_both_backends("ntscall", source, provider, METHODS_LIBRARY, &caller) else { return; };
        for output in outputs {
            // 4205; 42 * 7 with `other` null; 42 * 3 + 1.
            assert_eq!(output, expect("420794127", provider), "{provider:?}");
        }
    }
    // A default that is not a constant is refused: it would be evaluated
    // after every written argument, so one with an effect runs out of order
    // with an argument to its right. A call reading no parameter, which the
    // lowering before this accepted.
    let computed = source
        .replace("by: c_int = 7 as c_int", "by: c_int = seven()")
        .replace("export function run()", "let calls = 0;\nfunction seven(): c_int { calls++; return 7 as c_int; }\nexport function run()");
    let Some((_, prepared)) = prepare("ntscall-computed", &computed) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("an @ntsCall default that is not a constant")),
        "a computed default was accepted: {:?}",
        prepared.diagnostics
    );
}

/// A promise that settles with a C handle, awaited: GIO's
/// `await file.query_info_async(…)`, whose `_finish` returns a
/// `GFileInfo *`.
///
/// A handle is not a value -- the collector may not read it, and reference
/// counting may not retain it -- so the promise holds it in a slot of its own
/// (`nts_promise_fulfill_pointer` / `nts_promise_pointer`). The first handle is
/// held across two more `await`s, so it is spilled into the suspended frame and
/// read back after repeated suspension; all three are then used through a
/// method. And `Promise.all` over such promises is refused at compile time. Under reference
/// counting, fifty more runs leave nothing alive: the frames and promises are
/// released, and nothing tried to release the handles.
#[test]
fn a_promise_carries_a_c_handle_across_an_await_on_both_backends() {
    let source = r#"
import type { Class, c_int } from "c:types";
interface WidgetOwnMethods {
    /** @ntsSymbol widget_get_width */
    get_width(this: Widget): c_int;
}
type Widget = Class<"_Widget"> & WidgetOwnMethods;
type Button = Class<"_Button", Widget> & WidgetOwnMethods;
declare function button_new(): Button;
let total = 0;
async function later(): Promise<Button> {
    return button_new();
}
async function use(): Promise<void> {
    const first = await later();
    const second = await later();
    const third = await later();
    total = (first.get_width() as number) * 10000 + (second.get_width() as number) * 100 + (third.get_width() as number);
}
export function start(): void {
    total = 0;
    void use();
}
export function settled(): number { return total; }
"#;
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"start(); nts_checkpoint(); printf("%.0f", settled());"#, "start(); nts_checkpoint();");
        let Some((text, outputs)) = run_on_both_backends("promised-handle", source, provider, METHODS_LIBRARY, &caller) else { return; };
        assert!(text.contains("nts_promise_fulfill_pointer("), "the handle did not settle into the promise's slot");
        assert!(text.contains("nts_promise_pointer("), "the await did not read the handle from its slot");
        for output in outputs {
            assert_eq!(output, expect("424242", provider), "{provider:?}");
        }
    }

    // `Promise.all` collects values, and a handle settles outside the value:
    // refused where it is lowered, not left to the array being
    // unrepresentable.
    let all = r#"
import type { Class } from "c:types";
type Button = Class<"_Button">;
declare function button_new(): Button;
async function later(): Promise<Button> { return button_new(); }
export async function both(): Promise<void> {
    const pair = await Promise.all([later(), later()]);
    void pair;
}
"#;
    let Some((_, prepared)) = prepare("promised-handle-all", all) else { return; };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("over promises of C handles")),
        "`Promise.all` over handle promises was not refused where it is lowered: {:?}",
        prepared.diagnostics
    );
}

/// A `c_long` under Win64 crosses C's 32-bit slot and comes back the value
/// the slot held: sign-extended for `long`, zero-extended for `unsigned long`,
/// truncated going in.
///
/// **Bit 31 set is what makes the two extensions tell apart.** `-2^31`
/// through `long` comes back `-2^31` only if the result is sign-extended, and
/// `2^31` through `unsigned long` comes back `2^31` only if it is
/// zero-extended. Swapping them fails both checks. `2^32 + 5` is truncated to
/// `5`, which is the documented runtime behaviour. A struct field of `long`
/// is stored and loaded through its 4-byte slot without touching the `int`
/// after it.
///
/// **What runs where.**
/// - **LLVM's Win64 program runs on Windows** (`tooling/windows/run.sh`,
///   the lane's VM), built with its runtime for `x86_64-windows-gnu` against
///   helpers declared with `int32_t`/`uint32_t`, the slot a Win64 `long` is.
///   It used to run here, against Linux's runtime, which stopped being the
///   same program once Win64 calls the runtime by Win64's convention: a
///   `bigint` comes back in XMM0 there. With no Windows reachable the arm says
///   so by name.
/// - **C's Win64 program is compiled for `x86_64-w64-windows-gnu`**, where
///   its `sizeof(long) == 4` and offset assertions are checked by a real
///   LLP64 compiler.
/// - **The control** is the same program on `SysV` against `long` helpers:
///   nothing truncates there, so the truncation check fails and the bitmask
///   differs. That shows the ABI decided the answer.
#[test]
fn a_c_long_with_bit_31_set_crosses_the_win64_slot_on_both_backends() {
    let source = r#"
import { local } from "c:memory";
import type { Struct, c_int, c_long, c_ulong } from "c:types";
type Slot = Struct<{ before: c_int; value: c_long; after: c_int }, "slot">;
declare function echo_long(value: c_long): c_long;
declare function echo_ulong(value: c_ulong): c_ulong;
export function probe(seed: number): number {
    const low = (BigInt(seed) * -2147483648n) as c_long;
    const high = (BigInt(seed) * 2147483648n) as c_ulong;
    const wide = (BigInt(seed) * 4294967301n) as c_long;
    const slot = local<Slot>();
    slot[0].before = 1 as c_int;
    slot[0].after = 7 as c_int;
    slot[0].value = low;
    let mask = 0;
    if (echo_long(low) === low) mask |= 1;
    if (echo_ulong(high) === high) mask |= 2;
    if (echo_long(wide) === ((BigInt(seed) * 5n) as c_long)) mask |= 4;
    // Compared directly, which is the shape that could not be written until the
    // `i64`-against-`i128` defect was fixed: a `c_long` field loads as an `i64`
    // and a `c_long`-branded bigint is the `i128` it lives in, and nothing
    // widened either side. LLVM rejected the module and C hid it behind an
    // implicit conversion. `relational_operands` now widens to the bigint.
    if (slot[0].value === low && slot[0].before === 1 && slot[0].after === 7) mask |= 8;
    // A bigint whose halves differ, through the runtime's shifts: Win64 hands
    // an `i128` back as `<2 x i64>`, and a lane-swapped reinterpretation of one
    // is invisible to every value below 2^64.
    const split = (BigInt(seed) << 80n) | 0xdeadbeefn;
    if (split >> 16n === ((BigInt(seed) << 64n) | 0xdeadn)) mask |= 16;
    return mask;
}
"#;
    // Not `program.h`: that is the Win64 program's header, and its layout
    // assertions (a `long` at offset 4) are false for this Linux compiler --
    // which is them working. The caller needs only the one prototype.
    let caller = "#include <stdio.h>\ndouble probe(double);\nint main(void) { printf(\"%.0f\\n\", probe(1)); return 0; }\n";
    let win64_helpers = "#include <stdint.h>\nint32_t echo_long(int32_t v) { return v; }\nuint32_t echo_ulong(uint32_t v) { return v; }\n";
    let sysv_helpers = "long echo_long(long v) { return v; }\nunsigned long echo_ulong(unsigned long v) { return v; }\n";
    let Some((dir, prepared)) = prepare("win64-long", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let win64 = nts_core::hir::native::NativeAbi::Win64;
    let sysv = nts_core::hir::native::NativeAbi::SysV;

    let run = |abi, helpers: &str, name: &str| -> String {
        let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform { abi, arch: nts_codegen_llvm::Arch::X86_64 });
        assert!(llvm.diagnostics.is_empty(), "{name}: {:?}", llvm.diagnostics);
        let c = nts_codegen_c::emit(&prepared.program, abi);
        assert!(c.is_complete(), "{name}: {:?}", c.diagnostics);
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
        std::fs::write(dir.join("helpers.c"), helpers).unwrap();
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        for file in ["helpers.c", "caller.c", "nts_runtime.c"] {
            clang(&dir, &["-std=c11", "-O2", "-c", file]);
        }
        clang(&dir, &["-O2", "-Wno-override-module", "-c", "program.ll", "-o", "llvm.o"]);
        clang(&dir, &["llvm.o", "helpers.o", "caller.o", "nts_runtime.o", "-lm", "-o", name]);
        let out = Command::new(dir.join(name)).output().unwrap();
        assert!(out.status.success(), "{name}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    };
    // The control: on SysV nothing truncates, so `2^32 + 5` comes back whole.
    assert_eq!(run(sysv, sysv_helpers, "llvm-sysv"), "27", "the SysV control did not differ in exactly the truncation");

    let zig = Command::new("zig").arg("env").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    let Some(lib) = zig.as_deref().and_then(|env| env.split_once("lib_dir")).and_then(|(_, rest)| rest.split('"').nth(1).map(str::to_owned)) else {
        eprintln!("skipping the Win64 arms: no zig for mingw headers");
        return;
    };

    // LLVM's Win64 program, with the runtime it calls, on Windows.
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "llvm-win64: {:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let c = nts_codegen_c::emit(&prepared.program, win64);
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("helpers.c"), win64_helpers).unwrap();
    let built = Command::new("zig")
        .current_dir(&dir)
        .args(["cc", "-target", "x86_64-windows-gnu", "-O2", "-Wno-override-module", "program.ll", "helpers.c", "caller.c", "nts_runtime.c", "-o", "llvm-win64.exe"])
        .output()
        .unwrap();
    assert!(built.status.success(), "llvm-win64: {}", String::from_utf8_lossy(&built.stderr));
    let runner = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tooling/windows/run.sh");
    let ran = Command::new(runner).arg(dir.join("llvm-win64.exe")).output().unwrap();
    if ran.status.code() == Some(77) {
        eprintln!("llvm-win64: not run -- no Windows reachable (tooling/windows/vm.md)");
    } else {
        assert!(ran.status.success(), "llvm-win64 on Windows: {}", String::from_utf8_lossy(&ran.stderr));
        assert_eq!(String::from_utf8_lossy(&ran.stdout).trim(), "31", "the Win64 slot did not round-trip on Windows");
    }

    // C's Win64 program, checked by an LLP64 compiler. Its assertions state
    // `sizeof(long) == 4` and the slot's offsets (`after` at 8, not 16).
    let c = nts_codegen_c::emit(&prepared.program, win64);
    let text = c.writer.text();
    assert!(text.contains("sizeof(long) == 4"), "the C program does not assert the LLP64 model");
    assert!(text.contains("offsetof(struct slot, after) == 8u"), "the C program placed `after` for LP64");
    std::fs::write(dir.join("program.c"), text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    let headers = format!("{lib}/libc/include");
    clang(&dir, &[
        "--target=x86_64-w64-windows-gnu", "-nostdlibinc",
        "-isystem", &format!("{headers}/x86_64-windows-gnu"), "-isystem", &format!("{headers}/generic-mingw"),
        "-isystem", &format!("{headers}/x86_64-windows-any"), "-isystem", &format!("{headers}/any-windows-any"),
        "-D__MSVCRT_VERSION__=0xE00", "-D_WIN32_WINNT=0x0a00", "-std=c11", "-fsyntax-only", "program.c",
    ]);
}

/// A constant that does not fit Win64's 32-bit `long` is refused by both
/// backends, and not on `SysV`, where it fits. A wrap the compiler can see is not
/// left to happen silently.
#[test]
fn a_c_long_constant_too_wide_for_win64_is_refused_on_both_backends() {
    let source = r#"
import type { c_long, c_ulong } from "c:types";
declare function take_long(value: c_long): void;
declare function take_ulong(value: c_ulong): void;
export function fits(): void { take_long(-2147483648n as c_long); take_ulong(4294967295n as c_ulong); }
export function wide(): void { take_long(2147483648n as c_long); }
export function negative(): void { take_ulong(-1n as c_ulong); }
"#;
    let Some((_, prepared)) = prepare("win64-constants", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let win64 = nts_core::hir::native::NativeAbi::Win64;
    let sysv = nts_core::hir::native::NativeAbi::SysV;
    let refused = |diagnostics: &[nts_diagnostics::Diagnostic]| -> Vec<String> {
        diagnostics.iter().filter(|d| d.message.contains("does not fit")).map(|d| d.message.clone()).collect()
    };
    let c = refused(&nts_codegen_c::emit(&prepared.program, win64).diagnostics);
    let llvm = refused(&nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform { abi: win64, arch: nts_codegen_llvm::Arch::X86_64 }).diagnostics);
    assert_eq!(c.len(), 2, "C refused {c:?}");
    assert_eq!(c, llvm, "the two backends refused different constants");
    assert!(c.iter().any(|m| m.contains("2147483648")) && c.iter().any(|m| m.contains("-1")), "{c:?}");
    assert!(refused(&nts_codegen_c::emit(&prepared.program, sysv).diagnostics).is_empty(), "SysV refused a constant that fits");
    assert!(refused(&nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform { abi: sysv, arch: nts_codegen_llvm::Arch::X86_64 }).diagnostics).is_empty(), "SysV refused a constant that fits");
}

/// `F | null` passes NULL for `null` and a bridge for a function, and
/// `Ptr<void>` is C's `void *`, on both backends.
///
/// C decides from what it received, so each answer is observed where it
/// arrives. `apply_or` calls the callback when it is not NULL and returns its
/// fallback otherwise; `is_null` reports whether the `void *` it got was
/// NULL. Win32 has both shapes everywhere (`SetTimer`'s `TIMERPROC`, `LPVOID`),
/// and both were refused.
#[test]
fn a_nullable_callback_and_a_void_pointer_cross_on_both_backends() {
    let source = r#"
import type { Ptr, c_int } from "c:types";
declare function some_address(): Ptr<void>;
declare function apply_or(f: ((n: c_int) => c_int) | null, x: c_int, fallback: c_int): c_int;
declare function is_null(p: Ptr<void> | null): c_int;
function triple(n: c_int): c_int { return (n * 3) as c_int; }
export function withCallback(): number { return apply_or(triple, 5 as c_int, -1 as c_int); }
export function withNull(): number { return apply_or(null, 5 as c_int, -1 as c_int); }
export function nullPointer(): number { return is_null(null); }
export function realPointer(): number { return is_null(some_address()); }
"#;
    let library = "#include <stddef.h>\n\
        int apply_or(int (*f)(int), int x, int fallback) { return f ? f(x) : fallback; }\n\
        int is_null(void *p) { return p == NULL; }\n\
        static int somewhere;\n\
        void *some_address(void) { return &somewhere; }\n";
    let caller = counted_caller(
        r#"printf("%.0f %.0f %.0f %.0f", withCallback(), withNull(), nullPointer(), realPointer());"#,
        "withCallback(); withNull();",
    );
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((_, outputs)) = run_on_both_backends("nullable-callback", source, provider, library, &caller) else { return; };
        for output in outputs {
            assert_eq!(output, expect("15 -1 1 0", provider), "{provider:?}");
        }
    }
}

/// A `Utf16String` crosses as NUL-terminated UTF-16, on both backends: lent in
/// place when the string is stored as UTF-16, copied when it is one byte wide.
///
/// Each property is observed where C receives it:
/// - `sum` adds the units and counts them, so the text is compared, not
///   assumed.
/// - `same` is given one string twice. Lent, that is one pointer; copied, two
///   allocations alive at once, which can never be equal.
/// - A lone surrogate arrives as the unit it is (0xD800), where the UTF-8
///   crossing would have made it U+FFFD. It is built at run time: the literal
///   `"\ud800"` reaches the program as three U+FFFD (`.length` is 3, node's
///   is 1), which is `blockers/a-lone-surrogate-in-a-string-literal`.
/// - `null` arrives as NULL.
///
/// Under reference counting, fifty more rounds must leave nothing live, so a
/// copy that is never released shows up as a leak.
#[test]
fn a_utf16_string_crosses_lent_when_wide_and_copied_when_narrow_on_both_backends() {
    let source = r#"
import type { Utf16String, c_int } from "c:types";
declare function sum(s: Utf16String): c_int;
declare function same(a: Utf16String, b: Utf16String): c_int;
declare function is_null(s: Utf16String | null): c_int;
export function narrow(): number { return sum("AB"); }
export function wide(): number { return sum("αβ"); }
export function lone(): number { return sum(String.fromCharCode(0xd800)); }
export function lentWide(): number { const s = "αβγ"; return same(s, s); }
export function lentNarrow(): number { const s = "abc"; return same(s, s); }
export function nothing(): number { return is_null(null); }
"#;
    let library = "#include <stdint.h>\n#include <stddef.h>\n\
        int sum(const uint16_t *s) { int total = 0, n = 0; while (s[n]) total += s[n++]; return total * 10 + n; }\n\
        int same(const uint16_t *a, const uint16_t *b) { return a == b; }\n\
        int is_null(const uint16_t *s) { return s == NULL; }\n";
    let caller = counted_caller(
        r#"printf("%.0f %.0f %.0f %.0f %.0f %.0f", narrow(), wide(), lone(), lentWide(), lentNarrow(), nothing());"#,
        "narrow(); wide(); lentWide(); lentNarrow();",
    );
    // "AB" = 65+66 = 131 over 2 units; "αβ" = 945+946 = 1891 over 2; a lone
    // high surrogate is 55296 over 1.
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((text, outputs)) = run_on_both_backends("utf16-string", source, provider, library, &caller) else { return; };
        assert!(text.contains("nts_string_to_utf16(") && text.contains("nts_utf16_release("), "the UTF-16 pair is not in the C program");
        for output in outputs {
            assert_eq!(output, expect("1312 18912 552961 1 0 1", provider), "{provider:?}");
        }
    }
}

/// Only `string` beside the optional `__c_utf16` marker is a `Utf16String`.
/// `string & { real: number }` has a property a program can read, so it is a
/// value with a layout: taken for a plain string, a read of `.real` would be
/// at an offset nothing laid out. It is refused, not converted.
#[test]
fn a_string_intersected_with_a_real_property_is_not_a_utf16_string() {
    let source = r#"
import type { c_int } from "c:types";
declare function take(s: string & { real: number }): c_int;
export function go(s: string & { real: number }): number { return take(s); }
"#;
    let Some((_, prepared)) = prepare("utf16-not-a-brand", source) else { return; };
    assert!(
        // Refused where the value's type is read: `representation_of`'s
        // intersection arm did not take it.
        prepared.diagnostics.iter().any(|d| d.message.contains("unrepresentable type (an intersection)")),
        "`string & {{ real: number }}` crossed as a string: {:?}",
        prepared.diagnostics
    );
    assert!(
        !prepared.program.funcs.iter().flat_map(|f| &f.values).any(|op| matches!(
            &op.kind,
            hir::OpKind::Call { callee: hir::Callee::External(name), .. } if name == "nts_string_to_utf16"
        )),
        "a UTF-16 conversion was emitted for a string that is not a Utf16String"
    );
}

/// `c_long32`/`c_ulong32` are Windows' `LONG`/`DWORD`: a `number` in
/// TypeScript and C's 32-bit `long` on Win64, where every bit round-trips.
/// On a target whose `long` is 64 bits the same program is refused by both
/// backends, by name: it is a Windows binding.
///
/// All bits set in the unsigned one and a negative value in the signed one,
/// so a sign or zero extension done wrongly shows. LLVM's Win64 program runs
/// here against `int32_t`/`uint32_t` helpers, the slot a Win64 `long` is; C's
/// is checked by an LLP64 clang, as the `c_long` test does.
#[test]
fn a_c_long32_is_a_number_on_win64_and_refused_where_long_is_64_bits() {
    // The brands this test is the case for, read from the shared list.
    assert_eq!(WINDOWS_ONLY, ["c_long32", "c_ulong32"], "a Windows-only brand without a case here");
    let source = r#"
import type { c_long32, c_ulong32 } from "c:types";
declare function echo_dword(value: c_ulong32): c_ulong32;
declare function echo_long(value: c_long32): c_long32;
export function dword(): number { return echo_dword(4294967295 as c_ulong32); }
export function negative(): number { return echo_long(-5 as c_long32); }
"#;
    let Some((dir, prepared)) = prepare("long32", source) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let win64 = nts_core::hir::native::NativeAbi::Win64;
    let sysv = nts_core::hir::native::NativeAbi::SysV;

    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform { abi: win64, arch: nts_codegen_llvm::Arch::X86_64 });
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("helpers.c"), "#include <stdint.h>\nuint32_t echo_dword(uint32_t v) { return v; }\nint32_t echo_long(int32_t v) { return v; }\n").unwrap();
    std::fs::write(dir.join("caller.c"), "#include <stdio.h>\ndouble dword(void);\ndouble negative(void);\nint main(void) { printf(\"%.0f %.0f\\n\", dword(), negative()); return 0; }\n").unwrap();
    for file in ["helpers.c", "caller.c", "nts_runtime.c"] {
        clang(&dir, &["-std=c11", "-O2", "-c", file]);
    }
    clang(&dir, &["-O2", "-Wno-override-module", "-c", "program.ll", "-o", "llvm.o"]);
    clang(&dir, &["llvm.o", "helpers.o", "caller.o", "nts_runtime.o", "-lm", "-o", "run"]);
    let out = Command::new(dir.join("run")).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "4294967295 -5", "the Win64 slot did not round-trip");
    let text = c.writer.text();
    assert!(text.contains("unsigned long echo_dword(unsigned long);"), "C does not call through `unsigned long`:\n{text}");
    assert!(text.contains("long echo_long(long);"), "C does not call through `long`:\n{text}");

    let refused = |diagnostics: &[nts_diagnostics::Diagnostic]| -> Vec<String> {
        diagnostics.iter().filter(|d| d.message.contains("32-bit C `long`")).map(|d| d.message.clone()).collect()
    };
    let c_refused = refused(&nts_codegen_c::emit(&prepared.program, sysv).diagnostics);
    let llvm_refused = refused(&nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform { abi: sysv, arch: nts_codegen_llvm::Arch::X86_64 }).diagnostics);
    assert_eq!(c_refused.len(), 2, "C on SysV refused {c_refused:?}");
    assert_eq!(c_refused, llvm_refused, "the two backends refused different functions");
}

/// A cycle through a `GObject`: a signal handler capturing its own instance,
/// connected through `nts_gobject_connect` as `bind-gir`'s views are. Real
/// libgobject (a `GObject`'s own `notify` needs no display), on both backends
/// under reference counting, with the collector run by hand.
///
/// `itself` holds its instance from its own handler -- the cycle, which the
/// collector sees only through the instance's node -- and `other` a second
/// instance, which is no cycle. Both are finalized. `kept` is the same cycle
/// with the library holding one more reference: the node's count stays above
/// what the candidates hold, so it survives the collection, and goes at the
/// checkpoint after the library lets go. A collector that did not see through
/// the instance leaves
/// `itself` and `kept` alive; one that ignored the instance's own count
/// collects `kept` while the library holds it; and one that looked only at
/// releases of its own never collects `kept`, which the library let go of on
/// `GObject`'s side. The repeat asserts the closures are freed too (`leak=0`).
#[test]
fn a_cycle_through_a_gobject_is_collected_on_both_backends() {
    let pkg = |what: &str| -> Option<Vec<String>> {
        let output = Command::new("pkg-config").args([what, "gobject-2.0"]).output().ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).split_whitespace().map(str::to_owned).collect())
    };
    let (Some(cflags), Some(libs)) = (pkg("--cflags"), pkg("--libs")) else { return; };
    let cflags: Vec<&str> = cflags.iter().map(String::as_str).collect();
    let libs: Vec<&str> = libs.iter().map(String::as_str).collect();
    let source = r#"
import type { Class, Erased, ErasedClosure, GObjectClass, Owned, Ptr, c_int, c_uint, c_ulong } from "c:types";
type GClosure = Class<"_GClosure">;
type GParamSpec = Class<"_GParamSpec">;
interface GObjectMethods {
    /**
     * @ntsSymbol nts_gobject_connect
     * @ntsDefault connect_flags=0
     */
    connect(this: Erased<GObject>, detailed_signal: "notify", handler: ErasedClosure<(self: GObject, pspec: GParamSpec) => void, (data: Ptr<unknown>, closure: GClosure) => void>, connect_flags?: c_uint): c_ulong;
}
type GObject = GObjectClass<"_GObject"> & GObjectMethods;
declare function made(): Owned<GObject>;
declare function keep(object: GObject): void;
declare function let_go(): void;
declare function finalized(): c_int;
declare function collect(): void;
let touched = 0;
function itself(): void {
    const object = made();
    object.connect("notify", () => { keep(object); touched++; });
}
function other(): void {
    const keeper = made();
    const object = made();
    object.connect("notify", () => { keep(keeper); touched++; });
}
function kept(): void {
    const object = made();
    object.connect("notify", () => { let_go(); keep(object); touched++; });
    keep(object);
}
export function run(): number {
    const before = finalized() as number;
    itself();
    collect();
    const one = (finalized() as number) - before;
    other();
    collect();
    const two = (finalized() as number) - before;
    kept();
    collect();
    const three = (finalized() as number) - before;
    let_go();
    collect();
    const four = (finalized() as number) - before;
    return one * 1000 + two * 100 + three * 10 + four;
}
"#;
    let library = r"
#include <glib-object.h>
#include <stddef.h>
void nts_checkpoint(void);
static int gone;
static GObject *held;
static void finalize_counted(gpointer data, GObject *object) { (void)data; (void)object; gone++; }
GObject *made(void) {
    GObject *object = g_object_new(G_TYPE_OBJECT, NULL);
    g_object_weak_ref(object, finalize_counted, NULL);
    return object;
}
void keep(GObject *object) { if (held == NULL) held = g_object_ref(object); }
void let_go(void) { if (held != NULL) { GObject *object = held; held = NULL; g_object_unref(object); } }
int finalized(void) { return gone; }
void collect(void) { nts_checkpoint(); }
";
    let provider = hir::Provider::ReferenceCounting;
    let Some((dir, prepared)) = prepare_with_provider("gobject-cycle-rc", source, provider) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let support = c.support_files();
    assert!(support.iter().any(|file| file.name == nts_codegen_c::GOBJECT_SOURCE_NAME && file.compiled), "a program that connects does not bring nts_gobject.c");
    for file in &support { file.write(dir.as_std_path()).unwrap(); }
    std::fs::write(dir.join("native.c"), library).unwrap();
    let caller = counted_caller(r#"printf("%.0f", run());"#, "run();");
    std::fs::write(dir.join("caller.c"), caller).unwrap();
    let rc = ["-DNTS_PROVIDER_RC"];
    for file in ["native.c", "nts_gobject.c"] {
        clang(&dir, &[&["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file][..], &rc, &cflags].concat());
    }
    clang(&dir, &[&["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", "caller.c"][..], &rc].concat());
    clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], &rc].concat());
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], &rc].concat());
        clang(&dir, &[&[object, "native.o", "caller.o", "nts_runtime.o", "nts_gobject.o", "-lm", "-o", executable][..], &libs].concat());
        let run = Command::new(dir.join(executable)).env("G_DEBUG", "fatal-criticals").output().unwrap();
        assert!(run.status.success(), "{executable}: {}", String::from_utf8_lossy(&run.stderr));
        // Running totals: `itself` 1; `other` 2 more (its instance, freed
        // outright, released the handler that was the last to hold the
        // keeper); `kept` none while the library holds it, and 1 at the
        // checkpoint after it lets go -- a release on GObject's side, which
        // only the revisit sees.
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "1334 leak=0", "{executable}");
    }
}

/// A counted handle seen as a counted ancestor -- a `Thing` passed where a
/// `GObject` is taken, which is every inherited method's receiver -- borrows
/// the handle's reference instead of taking its own, where the handle is a
/// parameter or a foreign result this function reads. `inherited` calls
/// through the upcast in a loop, which paid `g_object_ref_sink` and
/// `g_object_unref` per call; its C has neither now.
///
/// The arms are the ways borrowing could be wrong: a view of a fresh +1
/// result, used twice; one held across a branch, where the handle's own last
/// use would otherwise be the conversion; one returned, which must be
/// retained where it leaves; one stored into a field; and a handle a closure
/// captured, viewed in a loop, which borrows from the environment. The fake counts a
/// count on a freed or NULL object as an error, and after fifty runs of each
/// nothing is alive.
#[test]
fn an_upcast_borrows_its_handles_reference_on_both_backends() {
    let source = r#"
import type { Class, GObjectClass, Owned, c_int } from "c:types";
type GTypeInstance = Class<"_GTypeInstance">;
type GObject = GObjectClass<"_GObject", GTypeInstance>;
type Thing = GObjectClass<"_Thing", GObject>;
declare function thing_new_owned(value: c_int): Owned<Thing>;
declare function object_value(object: GObject): c_int;
declare function errors_seen(): c_int;
declare function live_objects(): c_int;
function inherited(t: Thing, n: number): number {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += object_value(t) as number;
    return sum;
}
export function looped(): number { return inherited(thing_new_owned(2 as c_int), 3); }
export function fresh(): number { const t = thing_new_owned(4 as c_int); return (object_value(t) as number) + (object_value(t) as number); }
export function branched(flag: boolean): number {
    const o: GObject = thing_new_owned(6 as c_int);
    if (flag) return object_value(o) as number;
    return 0;
}
function up(t: Thing): GObject { return t; }
export function returned(): number { const o = up(thing_new_owned(8 as c_int)); return object_value(o) as number; }
class Holder { held: GObject; constructor(t: Thing) { this.held = t; } }
export function stored(): number { const h = new Holder(thing_new_owned(5 as c_int)); return object_value(h.held) as number; }
export function captured(): number {
    const t = thing_new_owned(3 as c_int);
    const sum = (n: number): number => {
        let s = 0;
        for (let i = 0; i < n; i++) s += object_value(t) as number;
        return s;
    };
    return sum(3);
}
export function errors(): number { return errors_seen() as number; }
export function live(): number { return live_objects() as number; }
"#;
    let library = format!(
        "{GOBJECT_LIBRARY}\nint object_value(struct _GObject *o) {{ Thing *t = (Thing *)o; return t->parent.freed ? -1 : t->value; }}\n"
    );
    let caller = counted_caller(
        r#"printf("%.0f %.0f %.0f %.0f %.0f %.0f", looped(), fresh(), branched(true), returned(), stored(), captured());
  for (int i = 0; i < 50; i++) { looped(); fresh(); branched(true); branched(false); returned(); stored(); captured(); }
  printf(" errors=%.0f live=%.0f", errors(), live());"#,
        "",
    );
    let Some((c, outputs)) =
        run_on_both_backends("upcast", source, hir::Provider::ReferenceCounting, &library, &caller)
    else {
        return;
    };
    let body = c.split("inherited(").nth(2).and_then(|rest| rest.split("\n}\n").next()).expect("inherited is emitted");
    assert!(!body.contains("ref_sink") && !body.contains("unref"), "the loop still counts its receiver:\n{body}");
    for output in outputs {
        assert_eq!(output, "6 8 6 8 5 9 errors=0 live=0 leak=0");
    }
}

/// `CNumber<C>`: a C number a binding takes and gives as a plain `number`, as
/// GJS does -- `gtk_box_new(VERTICAL, 4)`, no cast. The argument converts to
/// C's type at the call (2.9 to an `int` is 2, as a cast was), a result reads
/// back as a `number` that arithmetic keeps fractional, and a callback's
/// parameter and result cross the same way both directions.
#[test]
fn a_plain_number_crosses_as_its_c_type_on_both_backends() {
    let source = r#"
import type { CNumber } from "c:types";
declare function add(a: CNumber<"int">, b: CNumber<"double">): CNumber<"int">;
declare function halve(x: CNumber<"float">): CNumber<"double">;
declare function twice(callback: (n: CNumber<"int">) => CNumber<"int">, n: CNumber<"int">): CNumber<"int">;
declare function doubled(n: CNumber<"size_t">): CNumber<"size_t">;
function plus_one(n: number): number { return n + 1; }
// A 64-bit one crosses as C's `size_t` and is a `number` to the program.
export function wide(): number { return doubled(3.5) / 2 + 0.5; }
export function run(): number {
    const sum = add(2.9, 3.5);
    const half = halve(5);
    return (sum + 0.25) * 1000 + half * 100 + twice(plus_one, 40);
}
"#;
    let library = r"
int add(int a, double b) { return a + (int)b; }
double halve(float x) { return x / 2; }
int twice(int (*callback)(int), int n) { return callback(callback(n)) - n; }
#include <stddef.h>
size_t doubled(size_t n) { return 2 * n + 1; }
";
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.2f %.2f", run(), wide());"#, "run(); wide();");
        let Some((text, outputs)) = run_on_both_backends("cnumber", source, provider, library, &caller) else { return; };
        assert!(text.contains("int add(int, double)"), "a `CNumber` is not C's type");
        // add: 2 + 3 = 5 (2.9 truncates, 3.5 truncates in C), + 0.25 kept;
        // halve(5) = 2.5; twice: 40 -> 41 -> 42, minus 40 = 2. wide: 3.5
        // truncates to 3 in C, 2 * 3 + 1 = 7, / 2 = 3.5, + 0.5 = 4.
        for output in outputs {
            assert_eq!(output, expect("5502.00 4.00", provider), "{provider:?}");
        }
    }
    // What the program holds is a `number` whatever C's width, so a promise
    // of one settles -- the shape of every generated Promise form whose
    // `_finish` returns a `gsize`. Held as a `bigint`, this was refused as
    // "settling with a `bigint`".
    let settled = format!(
        "{source}\nexport function later(): Promise<CNumber<\"size_t\">> {{ return new Promise<CNumber<\"size_t\">>((resolve) => {{ resolve(doubled(3)); }}); }}\n"
    );
    let Some((_, prepared)) = prepare("cnumber-promise", &settled) else { return; };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
}
