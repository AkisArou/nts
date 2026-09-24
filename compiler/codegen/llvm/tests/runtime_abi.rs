//! Every call this backend makes into the C runtime agrees with the runtime's
//! declaration, on System V and on Win64.
//!
//! **The verifier does not check this.** With opaque pointers a call's
//! function type is its own, so `call ptr @f(i32 %t, i64 %p)` against
//! `declare ptr @f(ptr)` assembles, links, and passes two registers where the
//! callee reads a pointer. `opt -passes=lint` does check it, and this runs it
//! over a program that reaches each way the backend passes a sixteen-byte value:
//! through `call`, and through the sites that spell a helper by hand
//! (`instanceof`, `==` on erased values, the truthiness of one, a `bigint`
//! shift). Win64 passes each through memory where System V splits it into two
//! registers, which is the difference a lint finding would be.
//!
//! First it shows lint reports a mismatch at all, so a clean answer is one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

const PROGRAM: &str = r#"
class Point { constructor(public x: number) {} }
export function run(values: unknown[]): string {
  const n = BigInt(values.length);
  const seen = new Map<unknown, unknown>();
  let out = "";
  for (const value of values) {
    seen.set(value, value);
    if (seen.get(value) === value) out += "=";
    if (value === 1) out += "1";
    if (value) out += "t";
    if (value instanceof Point) out += "p";
  }
  const shifted = (n << 3n) >> 1n;
  return out + String(shifted) + String(values[0] === values[1]);
}
"#;

fn lint(text: &str, name: &str) -> Option<Vec<String>> {
    let dir = std::env::temp_dir().join(format!("nts-runtime-abi-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("m.ll");
    std::fs::write(&path, text).unwrap();
    let output = Command::new("opt").args(["-passes=lint", "-disable-output"]).arg(&path).output().ok()?;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(output.status.success(), "opt rejected the module: {}", String::from_utf8_lossy(&output.stderr));
    let report = String::from_utf8_lossy(&output.stderr).into_owned();
    let lines: Vec<&str> = report.lines().collect();
    Some(
        lines
            .windows(2)
            .filter(|pair| pair[0].contains("Call ") && pair[0].contains("mismatches"))
            .map(|pair| format!("{} {}", pair[0], pair[1].trim()))
            .collect(),
    )
}

#[test]
fn every_runtime_call_agrees_with_its_declaration() {
    let bad = "declare ptr @f(ptr)\ndefine void @g() {\n  %r = call ptr @f(i32 1, i64 2)\n  ret void\n}\n";
    let Some(found) = lint(bad, "control") else {
        eprintln!("skipped: no opt");
        return;
    };
    assert!(!found.is_empty(), "lint reported nothing for a call with the wrong arguments");

    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-runtime-abi-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/main.ts"), PROGRAM).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true }, "include": ["src"] }"#,
    )
    .unwrap();
    let tsconfig = Utf8Path::from_path(&dir).unwrap().join("tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    // Under reference counting as well: an erased value's retain and release
    // are spelled by hand, and were System V's split on Win64 too -- a crash
    // the first time a Windows program counted one.
    let counted = hir::prepare_with(&snapshot, &hir::Options { provider: hir::Provider::ReferenceCounting, ..hir::Options::default() }).unwrap();
    assert!(counted.diagnostics.is_empty(), "{:?}", counted.diagnostics);
    for platform in [nts_codegen_llvm::Platform::SYSV_X86_64, nts_codegen_llvm::Platform::WIN64_X86_64] {
        let emitted = nts_codegen_llvm::emit(&counted.program, platform);
        assert!(emitted.diagnostics.is_empty(), "{platform:?} --rc: {:?}", emitted.diagnostics);
        for helper in ["@nts_value_retain(", "@nts_value_release("] {
            assert!(emitted.text.contains(helper), "{platform:?} --rc: the program does not call {helper}");
        }
        let found = lint(&emitted.text, &format!("{platform:?}-rc")).unwrap();
        assert!(found.is_empty(), "{platform:?} --rc: calls that disagree with their declarations:\n{}", found.join("\n"));
    }
    for platform in [nts_codegen_llvm::Platform::SYSV_X86_64, nts_codegen_llvm::Platform::WIN64_X86_64] {
        let emitted = nts_codegen_llvm::emit(&prepared.program, platform);
        assert!(emitted.diagnostics.is_empty(), "{platform:?}: {:?}", emitted.diagnostics);
        // The program reaches each path this is about, or it checked nothing.
        for helper in [
            "@nts_map_set(",
            "@nts_map_get(",
            "@nts_is_class(",
            "@nts_value_truthy_fn(",
            "@nts_value_strict_eq(",
            "@nts_value_eq_number_fn(",
            "@nts_bigint_shl(",
        ] {
            assert!(emitted.text.contains(helper), "{platform:?}: the program does not call {helper}");
        }
        let found = lint(&emitted.text, &format!("{platform:?}")).unwrap();
        assert!(found.is_empty(), "{platform:?}: calls that disagree with their declarations:\n{}", found.join("\n"));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// arm64: an erased value crosses into the runtime as AAPCS64's `[2 x i64]`
/// and comes back the same way, so the program that reaches each hand-spelled
/// path emits whole and every call agrees with `signatures_arm64.rs`, under
/// both providers. Only an exported function crossing one is refused, as on
/// Win64.
#[test]
fn arm64_passes_an_erased_value_as_two_words() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-runtime-abi-arm64-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/main.ts"), PROGRAM).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true }, "include": ["src"] }"#,
    )
    .unwrap();
    let tsconfig = Utf8Path::from_path(&dir).unwrap().join("tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let arm64 = nts_codegen_llvm::Platform { abi: nts_core::hir::native::NativeAbi::SysV, arch: nts_codegen_llvm::Arch::Aarch64 };
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let prepared = hir::prepare_with(&snapshot, &hir::Options { provider, ..hir::Options::default() }).unwrap();
        assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
        let emitted = nts_codegen_llvm::emit(&prepared.program, arm64);
        // `run` is exported and returns a string, and takes `unknown[]` -- an
        // array, not an erased value -- so nothing here is refused.
        assert!(emitted.diagnostics.is_empty(), "arm64 {provider:?}: {:?}", emitted.diagnostics);
        for helper in ["@nts_map_set(", "@nts_value_truthy_fn(", "@nts_value_strict_eq(", "@nts_is_class("] {
            assert!(emitted.text.contains(helper), "arm64 {provider:?}: the program does not call {helper}");
        }
        assert!(emitted.text.contains("[2 x i64]"), "arm64 {provider:?}: no erased value crossed as two words");
        let Some(found) = lint(&emitted.text, &format!("arm64-{provider:?}")) else {
            eprintln!("skipped the lint: no opt");
            return;
        };
        assert!(found.is_empty(), "arm64 {provider:?}: calls that disagree with their declarations:\n{}", found.join("\n"));
    }
    let _ = std::fs::remove_dir_all(&dir);
}
