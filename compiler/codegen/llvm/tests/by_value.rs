//! Records passed and returned by value (`ByValue<T>`): the C each backend
//! makes of one, and what is refused where the binding is read.
//!
//! The C backend passes a record as `*p` and assigns a record result through
//! the storage the lowering made for it, and clang does the ABI. The LLVM
//! backend refuses by name until it classifies aggregates itself: a record is
//! carried in HIR as a pointer to it, so without the refusal it would pass
//! every check a pointer passes and hand C an address where C reads bytes.
//!
//! Running one is `examples/interop/native-byvalue`'s job, against the same
//! program in C, and `examples/interop/macos-geometry`'s on the lane's Mac.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

/// A program whose binding is an ambient declaration file of its own.
fn prepare(name: &str, binding: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!("target/by-value-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/objc/objc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

const GEOMETRY: &str = r#"
declare module "c:geometry" {
  import type { ByValue, Struct, c_double } from "c:types";
  export type Point = Struct<{ x: c_double; y: c_double }, "point">;
  export type Rect = Struct<{ origin: Point; size: Point }, "rect">;
  export function inset(r: ByValue<Rect>, by: c_double): ByValue<Rect>;
  export function area(r: ByValue<Rect>): c_double;
}
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { ByValue, Struct, c_double, c_ulong } from "c:types";
  import type { ObjcClass } from "objc:types";
  export type CGPoint = Struct<{ x: c_double; y: c_double }, "CGPoint">;
  export type CGRect = Struct<{ origin: CGPoint; size: CGPoint }, "CGRect">;
  export interface NSValueOwnMethods {
    /**
     * @ntsSelector rectValue
     */
    rectValue(this: NSValue): ByValue<CGRect>;
    /**
     * @ntsSelector hash
     */
    hash(this: NSValue): c_ulong;
  }
  export type NSValue = ObjcClass<"NSValue"> & NSValueOwnMethods;
  /**
   * @ntsSelector valueWithRect:
   * @ntsClass NSValue
   */
  export function valueWithRect(rect: ByValue<CGRect>): NSValue;
}
"#;

const PROGRAM: &str = r#"import { area, inset, type Rect } from "c:geometry";
import { valueWithRect, type CGRect } from "objc:Foundation";
import { local } from "c:memory";
import type { c_double } from "c:types";
export function run(): number {
  const r = local<Rect>();
  r.size.x = 4 as c_double;
  r.size.y = 5 as c_double;
  const smaller = inset(r, 1 as c_double);
  const boxed = valueWithRect(local<CGRect>());
  const back = boxed.rectValue();
  return area(smaller) + back.size.x;
}
"#;

#[test]
fn a_record_crosses_by_value_in_c() {
    let Some((dir, prepared)) = prepare("emit", GEOMETRY, PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();

    // The prototype says the record, not a pointer to it.
    assert!(text.contains("struct rect inset(struct rect, double);"), "no by-value prototype:\n{text}");
    assert!(text.contains("double area(struct rect);"), "{text}");
    // An argument is the record its storage holds; a result is assigned
    // through the storage the lowering made for it.
    let assigned = text.lines().find(|line| line.contains("= inset(")).unwrap_or_default();
    assert!(
        assigned.trim_start().starts_with('*') && assigned.contains("inset(*v"),
        "the record result is not assigned through its storage, or the argument is not dereferenced:\n{text}"
    );
    // A send returning a record picks its entry point by size, so x86_64 can
    // use `objc_msgSend_stret` and arm64, which has none, never names it.
    assert!(text.contains("NTS_OBJC_SEND_FOR(sizeof(struct CGRect))"), "no entry point chosen by size:\n{text}");
    assert!(text.contains("#if defined(__x86_64__)\nextern void objc_msgSend_stret(void);"), "{text}");

    // And it is C.
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), text).unwrap();
    let compiled = Command::new("clang")
        .args(["-std=c11", "-Wall", "-Werror", "-fsyntax-only"])
        .arg(dir.join("program.c"))
        .output();
    let Ok(compiled) = compiled else {
        eprintln!("skipped the compile: no clang");
        return;
    };
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// Where no send returns a record, nothing about `objc_msgSend_stret` is
/// emitted: the declaration is for programs that need it.
#[test]
fn a_program_with_no_record_results_declares_no_stret() {
    let source = r#"import { valueWithRect, type CGRect } from "objc:Foundation";
import { local } from "c:memory";
export function run(): bigint {
  return valueWithRect(local<CGRect>()).hash() as bigint;
}
"#;
    let Some((_, prepared)) = prepare("no-stret", GEOMETRY, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    let text = emitted.writer.text();
    assert!(!text.contains("stret") && !text.contains("NTS_OBJC_SEND_FOR"), "{text}");
    // Its sends are the plain cast they were.
    assert!(
        text.contains("((unsigned long (*)(const void *, struct objc_selector *))objc_msgSend)("),
        "{text}"
    );
}

/// The LLVM backend refuses, naming why, rather than passing the pointer.
#[test]
fn the_llvm_backend_refuses_a_record_by_value_by_name() {
    let Some((_, prepared)) = prepare("llvm", GEOMETRY, PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(
        llvm.diagnostics.iter().any(|d| d.message.contains("a C record passed or returned by value")),
        "{:?}",
        llvm.diagnostics
    );
}

/// Each record that cannot cross by value is refused where the binding is
/// read, naming it. The last case is the result's storage escaping, which is
/// `local<T>()`'s rule and so the result's.
#[test]
fn a_record_that_cannot_cross_by_value_is_refused_by_name() {
    // (name, declarations, what `run` imports, its return type, its body,
    // the refusal)
    let cases: [(&str, &str, &str, &str, &str, &str); 5] = [
        (
            "counted-member",
            r#"export type Holder = Struct<{ name: NSString; n: c_double }, "holder">;
  export function take(h: ByValue<Holder>): void;"#,
            "take, type Holder",
            "void",
            "take(local<Holder>());",
            "its member `name` is a counted handle",
        ),
        (
            "packed",
            r#"export type Tight = Packed<Struct<{ a: c_double; b: c_double }, "tight">>;
  export function take(h: ByValue<Tight>): void;"#,
            "take, type Tight",
            "void",
            "take(local<Tight>());",
            "is packed",
        ),
        (
            "variadic-result",
            r#"export type Pair = Struct<{ a: c_double; b: c_double }, "pair">;
  export function take(first: c_double, ...rest: c_double[]): ByValue<Pair>;"#,
            "take",
            "void",
            "take(1 as c_double);",
            "is variadic and returns a record by value",
        ),
        (
            "callback",
            r#"export type Pair = Struct<{ a: c_double; b: c_double }, "pair">;
  export function take(each: (p: ByValue<Pair>) => void): void;"#,
            "take",
            "void",
            "take(() => {});",
            "without a native ABI type",
        ),
        (
            "escaping-result",
            r#"export type Pair = Struct<{ a: c_double; b: c_double }, "pair">;
  export function make(): ByValue<Pair>;"#,
            "make, type Pair",
            "Ptr<Pair>",
            "return make();",
            "native local address escapes",
        ),
    ];
    for (name, declarations, imports, returns, body, expected) in cases {
        let binding = format!(
            r#"declare module "c:refused" {{
  import type {{ ByValue, Packed, Struct, c_double }} from "c:types";
  import type {{ ObjcClass }} from "objc:types";
  export type NSString = ObjcClass<"NSString">;
  {declarations}
}}
"#
        );
        let source = format!(
            "import {{ {imports} }} from \"c:refused\";\n\
             import {{ local }} from \"c:memory\";\n\
             import type {{ Ptr, c_double }} from \"c:types\";\n\
             export function run(): {returns} {{\n  {body}\n}}\n"
        );
        let Some((_, prepared)) = prepare(&format!("refuse-{name}"), &binding, &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(expected)),
            "{name}: no refusal saying `{expected}`: {:?}",
            prepared.diagnostics
        );
    }
}
