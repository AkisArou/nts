//! Records passed and returned by value (`ByValue<T>`): the C each backend
//! makes of one, and what is refused where the binding is read.
//!
//! The C backend passes a record as `*p` and assigns a record result through
//! the storage the lowering made for it, and clang does the ABI. The LLVM
//! backend classifies each record as `x86_64` System V does
//! (`src/aggregate.rs`), and the declarations it writes are compared with
//! clang's here. What it cannot classify, Win64 and unions, it refuses by
//! name: a record is carried in HIR as a pointer to it, so without the
//! refusal it would pass every check a pointer passes and hand C an address
//! where C reads bytes.
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

/// Shapes for the LLVM declarations to be compared with clang's: one per
/// eightbyte rule, and two that run out of registers. `(C declarations, the
/// same in a binding, the functions to compare)`.
const SHAPES_C: &str = r"
struct pd { double a; double b; };
struct pf { float a; float b; };
struct tf { float a; float b; float c; };
struct fd { float a; double b; };
struct ci { int a; double b; };
struct dc { double a; int b; };
struct cc { char a; char b; };
struct iii { int a; int b; int c; };
struct ic { int a; char b; };
struct pi { void *p; int n; };
struct big { long a; long b; long c; };
struct pd f_pd(struct pd v);
struct pf f_pf(struct pf v);
struct tf f_tf(struct tf v);
struct fd f_fd(struct fd v);
struct ci f_ci(struct ci v);
struct dc f_dc(struct dc v);
struct cc f_cc(struct cc v);
struct iii f_iii(struct iii v);
struct ic f_ic(struct ic v);
struct pi f_pi(struct pi v);
struct big f_big(struct big v, int n);
double sse_out(struct pd a, struct pd b, struct pd c, struct pd d, struct pd e);
long int_out(struct big x, struct ci a, struct ci b, struct ci c, struct ci d, struct ci e, struct ci f);
";

const SHAPES_TS: &str = r#"
declare module "c:shapes" {
  import type { ByValue, Ptr, Struct, c_char, c_double, c_float, c_int, c_long } from "c:types";
  export type Pd = Struct<{ a: c_double; b: c_double }, "pd">;
  export type Pf = Struct<{ a: c_float; b: c_float }, "pf">;
  export type Tf = Struct<{ a: c_float; b: c_float; c: c_float }, "tf">;
  export type Fd = Struct<{ a: c_float; b: c_double }, "fd">;
  export type Ci = Struct<{ a: c_int; b: c_double }, "ci">;
  export type Dc = Struct<{ a: c_double; b: c_int }, "dc">;
  export type Cc = Struct<{ a: c_char; b: c_char }, "cc">;
  export type Iii = Struct<{ a: c_int; b: c_int; c: c_int }, "iii">;
  export type Ic = Struct<{ a: c_int; b: c_char }, "ic">;
  export type Pi = Struct<{ p: Ptr<unknown>; n: c_int }, "pi">;
  export type Big = Struct<{ a: c_long; b: c_long; c: c_long }, "big">;
  export function f_pd(v: ByValue<Pd>): ByValue<Pd>;
  export function f_pf(v: ByValue<Pf>): ByValue<Pf>;
  export function f_tf(v: ByValue<Tf>): ByValue<Tf>;
  export function f_fd(v: ByValue<Fd>): ByValue<Fd>;
  export function f_ci(v: ByValue<Ci>): ByValue<Ci>;
  export function f_dc(v: ByValue<Dc>): ByValue<Dc>;
  export function f_cc(v: ByValue<Cc>): ByValue<Cc>;
  export function f_iii(v: ByValue<Iii>): ByValue<Iii>;
  export function f_ic(v: ByValue<Ic>): ByValue<Ic>;
  export function f_pi(v: ByValue<Pi>): ByValue<Pi>;
  export function f_big(v: ByValue<Big>, n: c_int): ByValue<Big>;
  export function sse_out(a: ByValue<Pd>, b: ByValue<Pd>, c: ByValue<Pd>, d: ByValue<Pd>, e: ByValue<Pd>): c_double;
  export function int_out(
    x: ByValue<Big>, a: ByValue<Ci>, b: ByValue<Ci>, c: ByValue<Ci>, d: ByValue<Ci>, e: ByValue<Ci>, f: ByValue<Ci>,
  ): c_long;
}
"#;

const SHAPES_PROGRAM: &str = r#"import * as shapes from "c:shapes";
import { local } from "c:memory";
import type { c_int } from "c:types";
export function run(): number {
  shapes.f_pd(local<shapes.Pd>());
  shapes.f_pf(local<shapes.Pf>());
  shapes.f_tf(local<shapes.Tf>());
  shapes.f_fd(local<shapes.Fd>());
  shapes.f_ci(local<shapes.Ci>());
  shapes.f_dc(local<shapes.Dc>());
  shapes.f_cc(local<shapes.Cc>());
  shapes.f_iii(local<shapes.Iii>());
  shapes.f_ic(local<shapes.Ic>());
  shapes.f_pi(local<shapes.Pi>());
  shapes.f_big(local<shapes.Big>(), 1 as c_int);
  const pd = local<shapes.Pd>();
  const ci = local<shapes.Ci>();
  return shapes.sse_out(pd, pd, pd, pd, pd) + Number(shapes.int_out(local<shapes.Big>(), ci, ci, ci, ci, ci, ci));
}
"#;

/// A declaration's parameter and result types, spelled comparably: no
/// parameter attributes clang adds as hints, a struct type written as its
/// size (clang names `%struct.pd`, this backend `[16 x i8]`), and `ptr` for
/// an INTEGER eightbyte that is a pointer (clang keeps the pointer type, this
/// backend the integer; the register is the same).
fn normalized(line: &str, sizes: &std::collections::BTreeMap<String, u32>) -> String {
    let mut text = line
        .replace(" noundef", "")
        .replace(" dead_on_unwind", "")
        .replace(" writable", "")
        .replace(" zeroext", "")
        .replace(" signext", "");
    for (name, size) in sizes {
        text = text.replace(&format!("%struct.{name}"), &format!("[{size} x i8]"));
    }
    let text = text.split(" #").next().unwrap_or_default().to_owned();
    text.replace("(ptr, i32)", "(i64, i32)").replace("{ ptr, i32 }", "{ i64, i32 }")
}

/// The eightbyte rules, checked against clang itself: each declaration this
/// backend writes for a record by value is the one clang writes for the same
/// C prototype, on `x86_64` System V.
#[test]
fn the_llvm_declarations_are_clangs() {
    let Some((dir, prepared)) = prepare("shapes", SHAPES_TS, SHAPES_PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);

    std::fs::write(dir.join("shapes.c"), format!(
        "{SHAPES_C}\nvoid *used[] = {{ (void *)f_pd, (void *)f_pf, (void *)f_tf, (void *)f_fd, (void *)f_ci, (void *)f_dc, \
         (void *)f_cc, (void *)f_iii, (void *)f_ic, (void *)f_pi, (void *)f_big, (void *)sse_out, (void *)int_out }};\n"
    )).unwrap();
    let Ok(clang) = Command::new("clang")
        .args(["--target=x86_64-unknown-linux-gnu", "-S", "-emit-llvm", "-O0", "-o", "-"])
        .arg(dir.join("shapes.c"))
        .output()
    else {
        eprintln!("skipped: no clang");
        return;
    };
    assert!(clang.status.success(), "{}", String::from_utf8_lossy(&clang.stderr));
    let sizes: std::collections::BTreeMap<String, u32> = [
        ("pd", 16), ("pf", 8), ("tf", 12), ("fd", 16), ("ci", 16), ("dc", 16), ("cc", 2), ("iii", 12), ("ic", 8),
        ("pi", 16), ("big", 24),
    ]
    .into_iter()
    .map(|(name, size)| (name.to_owned(), size))
    .collect();
    let theirs: std::collections::BTreeMap<String, String> = String::from_utf8_lossy(&clang.stdout)
        .lines()
        .filter(|line| line.starts_with("declare "))
        .map(|line| {
            let name = line.split('@').nth(1).and_then(|rest| rest.split('(').next()).unwrap_or_default().to_owned();
            (name, normalized(line, &sizes))
        })
        .collect();
    assert_eq!(theirs.len(), 13, "clang declared {theirs:?}");
    for (function, expected) in &theirs {
        let ours = llvm
            .text
            .lines()
            .find(|line| line.starts_with("declare ") && line.contains(&format!("@{function}(")))
            .map_or_else(|| panic!("no declaration of {function}:\n{}", llvm.text), |line| normalized(line, &sizes));
        assert_eq!(&ours, expected, "{function}");
    }
}

/// Under Win64 this backend knows no aggregate convention, and a union's
/// eightbytes are not ones it classifies: both refused by name, rather than
/// passed the way System V would pass a struct.
#[test]
fn the_llvm_backend_refuses_what_it_cannot_classify_by_name() {
    let Some((_, prepared)) = prepare("llvm-win64", GEOMETRY, PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(
        llvm.diagnostics.iter().any(|d| d.message.contains("under Win64, whose aggregate calling convention")),
        "{:?}",
        llvm.diagnostics
    );

    let binding = r#"declare module "c:u" {
  import type { ByValue, Union, c_double, c_int } from "c:types";
  export type Either = Union<{ d: c_double; i: c_int }, "either">;
  export function take(e: ByValue<Either>): void;
}
"#;
    let source = "import { take, type Either } from \"c:u\";\nimport { local } from \"c:memory\";\nexport function run(): void {\n  take(local<Either>());\n}\n";
    let Some((_, prepared)) = prepare("llvm-union", binding, source) else { return };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(
        llvm.diagnostics.iter().any(|d| d.message.contains("cannot classify (a union")),
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
            // Reworded when `native.rs`'s two messages were made noun phrases:
            // they ended in advice and were being interpolated into "… is not
            // supported by this lowering yet". `no_abi_type` builds both now.
            "a type with no native ABI",
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
