//! Recorded gap: the extension attributes on a narrow integer crossing C --
//! `signext` on an `i8`/`i16`, `zeroext` on an unsigned one and on a boolean
//! -- are the same on every platform here, and C's are not. Measured against
//! clang's own IR for the same prototypes: x86-64 System V and Apple arm64
//! extend narrow arguments and results, and so does this backend (the
//! controls); Win64, on x86-64 and arm64, and AAPCS64 Linux extend nothing
//! narrower than 32 bits except Win64 x86-64's `_Bool` result.
//!
//! Both directions are exposed. An attribute on an exported function's
//! parameter tells LLVM the C caller already extended it, and a Windows or
//! Linux-arm64 caller did not, so the upper bits may be dirty where the body
//! assumes them clean. On a C function's declared result it tells LLVM the C
//! callee extended it, and the same callees did not -- a Win32 `SHORT`,
//! `WORD` or `BYTE` result read through bits nothing set.
//!
//! When the attributes follow the platform, the gap rows become guards.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::{Command, hir, prepare_with_files};
use nts_codegen_llvm::{Arch, Platform};
use nts_core::hir::native::NativeAbi;

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
fn recorded_gap_narrow_integer_extensions_ignore_the_platform() {
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
    let aarch64 = |abi| Platform {
        abi,
        arch: Arch::Aarch64,
    };
    // (clang's triple, this backend's platform, whether the two agree today)
    let rows = [
        ("x86_64-linux-gnu", Platform::SYSV_X86_64, true),
        ("aarch64-apple-darwin", aarch64(NativeAbi::LP64), true),
        ("x86_64-windows-gnu", Platform::WIN64_X86_64, false),
        ("aarch64-windows-gnu", aarch64(NativeAbi::LLP64), false),
        (
            "aarch64-linux-gnu",
            aarch64(NativeAbi::LP64_UNSIGNED_CHAR),
            false,
        ),
    ];
    for (triple, platform, agrees) in rows {
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
            let (mine, c) = (extensions(&ours.text, name), extensions(&theirs, name));
            if agrees {
                assert_eq!(
                    mine, c,
                    "{triple} {name}: the control no longer agrees with clang"
                );
            } else {
                assert_ne!(
                    mine, c,
                    "{triple} {name}: this records the gap; when it fails because the \
                     attributes agree with clang, flip the row to a guard"
                );
            }
        }
    }
}
