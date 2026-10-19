//! The extension attributes on a narrow integer crossing C -- `signext` on an
//! `i8`/`i16`, `zeroext` on an unsigned one -- are clang's for the platform
//! (`Platform::extension`), checked against clang's own IR for the same
//! prototypes, in both directions: an exported function's parameters and a
//! C function's declared result and parameters. x86-64 System V and Apple
//! arm64 extend narrow arguments and results; Win64, on x86-64 and arm64, and
//! AAPCS64 Linux do not.
//!
//! **A guard; it was a recorded gap**, the same attributes on every platform.
//! On the three that do not extend, an attribute told LLVM a C caller had
//! cleaned an exported function's narrow argument, or a C callee its narrow
//! result -- a Win32 `SHORT`, `WORD` or `BYTE` read through upper bits nothing
//! set.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::{Command, hir, prepare_with_files};
use nts_codegen_llvm::Platform;

const SOURCE: &str = r#"
import { narrow_i8, narrow_take, narrow_u16 } from "c:narrow";
import type { Int8, Uint16 } from "@nts/scalars";
export function f(a: Int8, b: Uint16): number { return a + b; }
export function calls(): number {
  return narrow_i8() + narrow_u16() + narrow_take(-1 as Int8, 2 as Uint16);
}
"#;

const DECLARATIONS: &str = r#"
declare module "c:narrow" {
  import type { c_int, Int8, Uint16 } from "@nts/scalars";
  export function narrow_i8(): Int8;
  export function narrow_u16(): Uint16;
  export function narrow_take(a: Int8, b: Uint16): c_int;
}
"#;

/// The same prototypes in C, with built-in types so no target's headers are
/// needed.
const REFERENCE: &str = "double f(signed char a, unsigned short b) { return a + b; }\n\
    signed char narrow_i8(void);\n\
    unsigned short narrow_u16(void);\n\
    int narrow_take(signed char a, unsigned short b);\n\
    int use(void) { return narrow_i8() + narrow_u16() + narrow_take(-1, 2); }\n";

/// `signext` / `zeroext` on the result and on each parameter of `name`'s
/// `define` or `declare`, in that order, read off LLVM IR text.
fn extensions(ir: &str, name: &str) -> Vec<Vec<&'static str>> {
    let marker = format!("@{name}(");
    let line = ir
        .lines()
        .find(|line| {
            (line.starts_with("define ") || line.starts_with("declare ")) && line.contains(&marker)
        })
        .unwrap_or_else(|| panic!("no `{name}` in:\n{ir}"));
    let (head, rest) = line.split_once(&marker).unwrap();
    let params = &rest[..rest.find(')').unwrap()];
    let of = |text: &str| {
        ["signext", "zeroext"]
            .into_iter()
            .filter(|attribute| text.split_whitespace().any(|word| word == *attribute))
            .collect::<Vec<_>>()
    };
    std::iter::once(of(head))
        .chain(params.split(',').filter(|p| !p.trim().is_empty()).map(of))
        .collect()
}

#[test]
fn narrow_integer_extensions_follow_the_platform() {
    let Some((dir, prepared)) = prepare_with_files(
        "narrow-extension",
        SOURCE,
        hir::Provider::NoGc,
        &[("narrow.d.ts", DECLARATIONS)],
    ) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    std::fs::write(dir.join("reference.c"), REFERENCE).unwrap();
    // (clang's triple, this backend's platform)
    let rows = [
        ("x86_64-linux-gnu", Platform::SYSV_X86_64),
        ("aarch64-apple-darwin", Platform::APPLE_ARM64),
        ("x86_64-windows-gnu", Platform::WIN64_X86_64),
        ("aarch64-windows-gnu", Platform::WINDOWS_ARM64),
        ("aarch64-linux-gnu", Platform::LINUX_ARM64),
    ];
    for (triple, platform) in rows {
        let ours = nts_codegen_llvm::emit(&prepared.program, platform);
        assert!(
            ours.diagnostics.is_empty(),
            "{triple}: {:?}",
            ours.diagnostics
        );
        let clang = Command::new("clang")
            .current_dir(&dir)
            .args([
                "-target",
                triple,
                "-O1",
                "-S",
                "-emit-llvm",
                "-o",
                "-",
                "reference.c",
            ])
            .output()
            .unwrap();
        assert!(
            clang.status.success(),
            "{triple}: {}",
            String::from_utf8_lossy(&clang.stderr)
        );
        let theirs = String::from_utf8_lossy(&clang.stdout);
        for name in ["f", "narrow_i8", "narrow_u16", "narrow_take"] {
            assert_eq!(
                extensions(&ours.text, name),
                extensions(&theirs, name),
                "{triple} {name}: the extension attributes disagree with clang's"
            );
        }
    }
}
