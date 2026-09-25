//! Records passed and returned by value (`ByValue<T>`): the C each backend
//! makes of one, and what is refused where the binding is read.
//!
//! The C backend passes a record as `*p` and assigns a record result through
//! the storage the lowering made for it, and clang does the ABI. The LLVM
//! backend classifies each record as `x86_64` System V or Win64 does
//! (`src/aggregate.rs`), and the declarations it writes are compared with
//! clang's for each target here. What it cannot classify, anything on arm64
//! and a union under System V, it refuses by name: a record is carried in HIR
//! as a pointer to it, so without the refusal it would pass every check a
//! pointer passes and hand C an address where C reads bytes.
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
/// System V eightbyte rule, two that run out of registers, and one of each
/// size Win64 passes in a register (1, 2, 4 and 8 bytes, `struct { double }`
/// among them). `(C declarations, the
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
struct c1 { char a; };
struct f1 { float a; };
struct d1 { double a; };
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
struct c1 f_c1(struct c1 v);
struct f1 f_f1(struct f1 v);
struct d1 f_d1(struct d1 v);
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
  export type C1 = Struct<{ a: c_char }, "c1">;
  export type F1 = Struct<{ a: c_float }, "f1">;
  export type D1 = Struct<{ a: c_double }, "d1">;
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
  export function f_c1(v: ByValue<C1>): ByValue<C1>;
  export function f_f1(v: ByValue<F1>): ByValue<F1>;
  export function f_d1(v: ByValue<D1>): ByValue<D1>;
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
  shapes.f_c1(local<shapes.C1>());
  shapes.f_f1(local<shapes.F1>());
  shapes.f_d1(local<shapes.D1>());
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
///
/// Under Win64 a record passed in memory is `ptr dead_on_return` in clang's
/// declaration and `ptr byval(...)` in this backend's: a pointer to a copy the
/// caller makes, which is what LLVM makes of `byval` on that target, and
/// [`byval_is_a_pointer_to_a_copy_on_win64`] checks. Both become `ptr`.
fn normalized(line: &str, sizes: &std::collections::BTreeMap<String, u32>) -> String {
    let mut text = line
        .replace(" dso_local", "")
        .replace(" dead_on_return", "")
        .replace(" noundef", "")
        .replace(" dead_on_unwind", "")
        .replace(" writable", "")
        .replace(" zeroext", "")
        .replace(" signext", "");
    for (name, size) in sizes {
        text = text.replace(&format!("%struct.{name}"), &format!("[{size} x i8]"));
    }
    let text = text.split(" #").next().unwrap_or_default().to_owned();
    let text = if text.contains("byval(") {
        let mut out = String::new();
        let mut rest = text.as_str();
        while let Some(at) = rest.find(" byval(") {
            out.push_str(&rest[..at]);
            let after = &rest[at..];
            let end = after.find(')').unwrap() + 1;
            let after = &after[end..];
            // ` align N`
            let after = after.strip_prefix(" align ").map_or(after, |a| a.trim_start_matches(char::is_numeric));
            rest = after;
        }
        out.push_str(rest);
        out
    } else {
        text
    };
    text.replace("(ptr, i32)", "(i64, i32)").replace("{ ptr, i32 }", "{ i64, i32 }")
}

/// The eightbyte rules, checked against clang itself: each declaration this
/// backend writes for a record by value is the one clang writes for the same
/// C prototype, on `x86_64` System V.
#[test]
fn the_llvm_declarations_are_clangs() {
    compare_with_clang(nts_codegen_llvm::Platform::SYSV_X86_64, "x86_64-unknown-linux-gnu", 24);
}

/// The same on Win64, where the rule is the record's size alone. `big` is
/// three `long`s, which LLP64 makes twelve bytes.
#[test]
fn the_llvm_declarations_are_clangs_on_win64() {
    compare_with_clang(nts_codegen_llvm::Platform::WIN64_X86_64, "x86_64-w64-windows-gnu", 12);
}

fn compare_with_clang(platform: nts_codegen_llvm::Platform, triple: &str, big: u32) {
    let Some((dir, prepared)) = prepare(&format!("shapes-{triple}"), SHAPES_TS, SHAPES_PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, platform);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);

    std::fs::write(dir.join("shapes.c"), format!(
        "{SHAPES_C}\nvoid *used[] = {{ (void *)f_pd, (void *)f_pf, (void *)f_tf, (void *)f_fd, (void *)f_ci, (void *)f_dc, \
         (void *)f_cc, (void *)f_iii, (void *)f_ic, (void *)f_pi, (void *)f_big, (void *)f_c1, (void *)f_f1, (void *)f_d1, \
         (void *)sse_out, (void *)int_out }};\n"
    )).unwrap();
    let Ok(clang) = Command::new("clang")
        .args([&format!("--target={triple}"), "-S", "-emit-llvm", "-O0", "-o", "-"])
        .arg(dir.join("shapes.c"))
        .output()
    else {
        eprintln!("skipped: no clang");
        return;
    };
    assert!(clang.status.success(), "{}", String::from_utf8_lossy(&clang.stderr));
    let sizes: std::collections::BTreeMap<String, u32> = [
        ("pd", 16), ("pf", 8), ("tf", 12), ("fd", 16), ("ci", 16), ("dc", 16), ("cc", 2), ("iii", 12), ("ic", 8),
        ("pi", 16), ("big", big), ("c1", 1), ("f1", 4), ("d1", 8),
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
    assert_eq!(theirs.len(), 16, "clang declared {theirs:?}");
    for (function, expected) in &theirs {
        let ours = llvm
            .text
            .lines()
            .find(|line| line.starts_with("declare ") && line.contains(&format!("@{function}(")))
            .map_or_else(|| panic!("no declaration of {function}:\n{}", llvm.text), |line| normalized(line, &sizes));
        assert_eq!(&ours, expected, "{function}");
    }
}

/// On arm64 this backend knows no aggregate convention, and under System V a
/// union's eightbytes are not ones it classifies: both refused by name, rather
/// than passed the way `x86_64` System V would pass a struct. Under Win64 the
/// same union crosses, because there the rule is its size alone.
#[test]
fn the_llvm_backend_refuses_what_it_cannot_classify_by_name() {
    let Some((_, prepared)) = prepare("llvm-arm64", GEOMETRY, PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let windows_arm64 = nts_codegen_llvm::Platform { abi: nts_core::hir::native::NativeAbi::Win64, arch: nts_codegen_llvm::Arch::Aarch64 };
    let llvm = nts_codegen_llvm::emit(&prepared.program, windows_arm64);
    assert!(
        llvm.diagnostics.iter().any(|d| d.message.contains("crossing a call on arm64 Windows")),
        "{:?}",
        llvm.diagnostics
    );
    // Apple's and Linux's arm64 place the same rectangle: four doubles, in
    // `d0`-`d3` both ways, and a send that returns one needs no `_stret`.
    let arm64 = nts_codegen_llvm::Platform { abi: nts_core::hir::native::NativeAbi::SysV, arch: nts_codegen_llvm::Arch::Aarch64 };
    let llvm = nts_codegen_llvm::emit(&prepared.program, arm64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(
        llvm.text.contains("declare { double, double, double, double } @inset([4 x double], double)"),
        "{}",
        llvm.text
    );
    assert!(!llvm.text.contains("call void (ptr, ptr, ptr) @objc_msgSend_stret"), "{}", llvm.text);

    let binding = r#"declare module "c:u" {
  import type { ByValue, Union, c_double, c_int } from "c:types";
  export type Either = Union<{ d: c_double; i: c_int }, "either">;
  export function take(e: ByValue<Either>): void;
}
"#;
    let source = "import { take, type Either } from \"c:u\";\nimport { local } from \"c:memory\";\nexport function run(): void {\n  take(local<Either>());\n}\n";
    let Some((_, prepared)) = prepare("llvm-union", binding, source) else { return };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(
        llvm.diagnostics.iter().any(|d| d.message.contains("cannot classify (a union")),
        "{:?}",
        llvm.diagnostics
    );
    let win64 = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(win64.diagnostics.is_empty(), "{:?}", win64.diagnostics);
    assert!(win64.text.contains("declare void @take(i64)"), "an 8-byte union is not one integer:\n{}", win64.text);
}

/// AAPCS64's shapes, one per rule in `aggregate`'s module doc, and results of
/// the sizes an argument is refused at. `(C declarations, binding, program)`.
const ARM64_C: &str = r"
struct pd { double a; double b; };
struct d1 { double a; };
struct quad { double a; double b; double c; double d; };
struct rect { struct pd origin; struct pd size; };
struct ci { int a; double b; };
struct ic { int a; char b; };
struct pi { void *p; int n; };
struct c3 { char a; char b; char c; };
struct tf { float a; float b; float c; };
struct big { long a; long b; long c; };
struct pd f_pd(struct pd v);
struct d1 f_d1(struct d1 v);
struct quad f_quad(struct quad v);
struct rect f_rect(struct rect v, double by);
struct ci f_ci(struct ci v);
struct ic f_ic(struct ic v);
struct pi f_pi(struct pi v);
struct c3 make_c3(int n);
struct tf make_tf(int n);
struct big make_big(int n);
double spill(struct rect a, struct rect b, struct rect c);
";

const ARM64_TS: &str = r#"
declare module "c:shapes" {
  import type { ByValue, Ptr, Struct, c_char, c_double, c_float, c_int, c_long } from "c:types";
  export type Pd = Struct<{ a: c_double; b: c_double }, "pd">;
  export type D1 = Struct<{ a: c_double }, "d1">;
  export type Quad = Struct<{ a: c_double; b: c_double; c: c_double; d: c_double }, "quad">;
  export type Rect = Struct<{ origin: Pd; size: Pd }, "rect">;
  export type Ci = Struct<{ a: c_int; b: c_double }, "ci">;
  export type Ic = Struct<{ a: c_int; b: c_char }, "ic">;
  export type Pi = Struct<{ p: Ptr<unknown>; n: c_int }, "pi">;
  export type C3 = Struct<{ a: c_char; b: c_char; c: c_char }, "c3">;
  export type Tf = Struct<{ a: c_float; b: c_float; c: c_float }, "tf">;
  export type Big = Struct<{ a: c_long; b: c_long; c: c_long }, "big">;
  export function f_pd(v: ByValue<Pd>): ByValue<Pd>;
  export function f_d1(v: ByValue<D1>): ByValue<D1>;
  export function f_quad(v: ByValue<Quad>): ByValue<Quad>;
  export function f_rect(v: ByValue<Rect>, by: c_double): ByValue<Rect>;
  export function f_ci(v: ByValue<Ci>): ByValue<Ci>;
  export function f_ic(v: ByValue<Ic>): ByValue<Ic>;
  export function f_pi(v: ByValue<Pi>): ByValue<Pi>;
  export function make_c3(n: c_int): ByValue<C3>;
  export function make_tf(n: c_int): ByValue<Tf>;
  export function make_big(n: c_int): ByValue<Big>;
  export function spill(a: ByValue<Rect>, b: ByValue<Rect>, c: ByValue<Rect>): c_double;
}
"#;

const ARM64_PROGRAM: &str = r#"import * as shapes from "c:shapes";
import { local } from "c:memory";
import type { c_double, c_int } from "c:types";
export function run(): number {
  shapes.f_pd(local<shapes.Pd>());
  shapes.f_d1(local<shapes.D1>());
  shapes.f_quad(local<shapes.Quad>());
  shapes.f_rect(local<shapes.Rect>(), 1 as c_double);
  shapes.f_ci(local<shapes.Ci>());
  shapes.f_ic(local<shapes.Ic>());
  shapes.f_pi(local<shapes.Pi>());
  shapes.make_c3(1 as c_int);
  shapes.make_tf(1 as c_int);
  shapes.make_big(1 as c_int);
  const r = local<shapes.Rect>();
  return shapes.spill(r, r, r);
}
"#;

/// AAPCS64 against clang for `arm64-apple-macos13`. clang names a record
/// result by its struct type where this backend writes the literal one of its
/// members, which LLVM returns in the same registers; the comparison maps
/// each name to what this backend spells it as.
#[test]
fn the_llvm_declarations_are_clangs_on_arm64() {
    let Some((dir, prepared)) = prepare("shapes-arm64", ARM64_TS, ARM64_PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let arm64 = nts_codegen_llvm::Platform { abi: nts_core::hir::native::NativeAbi::SysV, arch: nts_codegen_llvm::Arch::Aarch64 };
    let llvm = nts_codegen_llvm::emit(&prepared.program, arm64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("shapes.c"), format!(
        "{ARM64_C}\nvoid *used[] = {{ (void *)f_pd, (void *)f_d1, (void *)f_quad, (void *)f_rect, (void *)f_ci, (void *)f_ic, \
         (void *)f_pi, (void *)make_c3, (void *)make_tf, (void *)make_big, (void *)spill }};\n"
    )).unwrap();
    let Ok(clang) = Command::new("clang")
        .args(["--target=arm64-apple-macos13", "-S", "-emit-llvm", "-O0", "-o", "-"])
        .arg(dir.join("shapes.c"))
        .output()
    else {
        eprintln!("skipped: no clang");
        return;
    };
    assert!(clang.status.success(), "{}", String::from_utf8_lossy(&clang.stderr));
    let spelled = [
        ("pd", "{ double, double }"),
        ("d1", "{ double }"),
        ("quad", "{ double, double, double, double }"),
        ("rect", "{ double, double, double, double }"),
        ("tf", "{ float, float, float }"),
        ("big", "[24 x i8]"),
    ];
    let spell = |line: &str| {
        let mut text = normalized(line, &std::collections::BTreeMap::new());
        for (name, ours) in spelled {
            text = text.replace(&format!("%struct.{name}"), ours);
        }
        text
    };
    let theirs: std::collections::BTreeMap<String, String> = String::from_utf8_lossy(&clang.stdout)
        .lines()
        .filter(|line| line.starts_with("declare "))
        .map(|line| (line.split('@').nth(1).and_then(|rest| rest.split('(').next()).unwrap_or_default().to_owned(), spell(line)))
        .collect();
    assert_eq!(theirs.len(), 11, "clang declared {theirs:?}");
    for (function, expected) in &theirs {
        let ours = llvm
            .text
            .lines()
            .find(|line| line.starts_with("declare ") && line.contains(&format!("@{function}(")))
            .map_or_else(|| panic!("no declaration of {function}:\n{}", llvm.text), spell);
        assert_eq!(&ours, expected, "{function}");
    }
}

/// On arm64 only what the convention places is refused: a scalar C call and
/// an Objective-C send with no record in it emit, as they do on `x86_64`.
#[test]
fn arm64_refuses_only_what_its_convention_places() {
    let binding = r#"declare module "c:scalars" {
  import type { c_double, c_int } from "c:types";
  export function scaled(n: c_int, by: c_double): c_double;
}
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_ulong } from "c:types";
  import type { ObjcClass } from "objc:types";
  export interface NSObjectOwnMethods {
    /**
     * @ntsSelector hash
     */
    hash(this: NSObject): c_ulong;
  }
  export type NSObject = ObjcClass<"NSObject"> & NSObjectOwnMethods;
  /**
   * @ntsSelector new
   * @ntsClass NSObject
   */
  export function make(): NSObject;
}
"#;
    let source = "import { scaled } from \"c:scalars\";\nimport { make } from \"objc:Foundation\";\nimport type { c_double, c_int } from \"c:types\";\nexport function run(): number {\n  return scaled(2 as c_int, 1.5 as c_double) + Number(make().hash());\n}\n";
    let Some((_, prepared)) = prepare("arm64-scalars", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let arm64 = nts_codegen_llvm::Platform { abi: nts_core::hir::native::NativeAbi::SysV, arch: nts_codegen_llvm::Arch::Aarch64 };
    let llvm = nts_codegen_llvm::emit(&prepared.program, arm64);
    assert!(llvm.diagnostics.is_empty(), "a scalar call or send was refused on arm64: {:?}", llvm.diagnostics);
    assert!(llvm.text.contains("@scaled("), "{}", llvm.text);
    assert!(llvm.text.contains("objc_msgSend"), "{}", llvm.text);
}

/// What the Win64 comparison above assumes: that LLVM makes of `byval`, on
/// that target, the pointer to a caller's copy clang passes for a record that
/// is not 1, 2, 4 or 8 bytes. Assembled, the caller copies the record to its
/// own frame and passes that copy's address in the first argument register.
#[test]
fn byval_is_a_pointer_to_a_copy_on_win64() {
    let module = "%T = type { ptr, ptr, double }\n\
                  declare void @take(ptr byval(%T) align 8)\n\
                  define void @f(ptr %p) {\n  call void @take(ptr byval(%T) align 8 %p)\n  ret void\n}\n";
    let dir = std::env::temp_dir().join(format!("nts-byval-win64-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("m.ll"), module).unwrap();
    let Ok(out) = Command::new("clang")
        .args(["--target=x86_64-w64-windows-gnu", "-O1", "-S", "-o", "-"])
        .arg(dir.join("m.ll"))
        .output()
    else {
        eprintln!("skipped: no clang");
        return;
    };
    let _ = std::fs::remove_dir_all(&dir);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let asm = String::from_utf8_lossy(&out.stdout);
    let body: Vec<&str> = asm.lines().skip_while(|line| !line.starts_with("f:")).take_while(|line| !line.contains("retq")).collect();
    let body = body.join("\n");
    // The copy: the record read through the incoming pointer (`%rcx`) into the
    // caller's frame, then that frame address passed in `%rcx`.
    assert!(body.contains("(%rcx)"), "the record is not copied from the incoming pointer:\n{body}");
    assert!(body.contains("leaq") && body.contains("(%rsp), %rcx"), "no address of a copy in %rcx:\n{body}");
    assert!(body.contains("callq\ttake"), "{body}");
}

/// A module-scope variable may hold a native handle, and a pointer into a
/// function's own storage is one: stored into the global, it would outlive
/// the frame it points into. `local<T>()`'s escape rule is what refuses it --
/// the one thing between a handle global and a pointer to a dead frame.
#[test]
fn a_local_stored_in_a_global_is_refused() {
    let binding = r#"declare module "c:held" {
  import type { Struct, c_double } from "c:types";
  export type Pair = Struct<{ a: c_double; b: c_double }, "pair">;
}
"#;
    let source = "import type { Pair } from \"c:held\";\n\
                  import { local } from \"c:memory\";\n\
                  import type { Ptr } from \"c:types\";\n\
                  let held: Ptr<Pair> | null = null;\n\
                  export function run(): void {\n  held = local<Pair>();\n}\n";
    let Some((_, prepared)) = prepare("held-local", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("native local address escapes")),
        "a local's address stored into a global is not refused: {:?}",
        prepared.diagnostics
    );
    // The control: memory that outlives the frame is a pointer a global may
    // hold, so the refusal above is the escape rule's and not the global's.
    let heap = source.replace("import { local } from \"c:memory\";", "import { malloc } from \"c:stdlib\";").replace("local<Pair>()", "malloc<Pair>(16)");
    let Some((_, prepared)) = prepare("held-heap", binding, &heap) else { return };
    assert!(prepared.diagnostics.is_empty(), "a heap pointer is refused as a global: {:?}", prepared.diagnostics);
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
