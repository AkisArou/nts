//! One HIR, two backends, the same answers.
//!
//! This is the reason the C backend does not go away when the LLVM one grows
//! up. A disagreement between them is a *backend* bug by construction: the
//! program, the lowering, every optimisation and the runtime are identical, and
//! only the rendering differs. Nothing else in this repository can isolate a
//! backend that way — the differential compares against node, which is the
//! right oracle for semantics and says nothing about which renderer was wrong.
//!
//! scriptc gave this up. Their C backend cannot express coroutines, so it is
//! debug-only and their LLVM output has no second opinion. Ours can, because
//! suspension is a *middle end* transform: `hir::suspend` turns a suspending
//! function into a state machine before any backend sees it.
//!
//! The pool is deliberately hostile in the same way the differential's is: both
//! zeroes, both infinities, a NaN, past 2^53, and the 1e21 notation boundary.
//! An arithmetic backend that is right about ordinary numbers and wrong about
//! these is right about nothing.

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// The values every function is driven with.
const POOL: &str = "{0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 1.0/0.0, -1.0/0.0, 0.0/0.0, \
                    9007199254740993.0, 2147483648.0}";

fn tsgo() -> Option<String> {
    let path = std::env::var("NTS_TSGO").ok()?;
    std::path::Path::new(&path).exists().then_some(path)
}

/// Lower a fixture, render it both ways, build both, run both, compare.
fn both_backends(case: &str, source: &str, driver: &str) -> Option<(String, String)> {
    let tsgo = tsgo()?;
    // Per *case*, not per process: `cargo test` runs these in parallel and one
    // directory keyed on the pid means two tests writing each other's
    // `program.ll`. Which is how this was found -- the test that had passed
    // started failing the moment a second one existed.
    let dir = std::env::temp_dir().join(format!("nts-llvm-{}-{case}", std::process::id()));
    let src = dir.join("src");
    std::fs::create_dir_all(&src).expect("a work directory");
    std::fs::write(src.join("main.ts"), source).expect("write the program");
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ESNext", "module": "ESNext",
             "moduleResolution": "bundler", "strict": true,
             "noUncheckedIndexedAccess": true, "noEmit": true },
             "include": ["src"] }"#,
    )
    .expect("write the tsconfig");

    let tsconfig = Utf8Path::from_path(&dir)
        .expect("utf-8 path")
        .join("tsconfig.json");
    let mut source_api = TsgoApi::for_compilation(tsgo);
    let snapshot = source_api
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "the fixture should typecheck");
    let prepared = hir::prepare(&snapshot).expect("prepared HIR should verify");

    // LLVM.
    let llvm = nts_codegen_llvm::emit(&prepared.program);
    assert!(
        llvm.diagnostics.is_empty(),
        "the LLVM backend declined: {:?}",
        llvm.diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    std::fs::write(dir.join("program.ll"), &llvm.text).expect("write the IR");

    // C.
    let c = nts_codegen_c::emit(&prepared.program);
    assert!(c.diagnostics.is_empty(), "the C backend declined");
    std::fs::write(dir.join("program.c"), c.writer.text()).expect("write the C");
    // Through `support_files` rather than by naming the header and the source:
    // `nts_runtime.c` includes `quickjs/dtoa.c`, which has to land in a
    // subdirectory beside it, and a program that converts case needs a second
    // translation unit as well. Every place that builds a program shares this
    // list precisely so none of them falls behind one that changes.
    let mut runtime_sources: Vec<std::path::PathBuf> = Vec::new();
    for file in nts_codegen_c::support_files(c.needs_unicode()) {
        let written = file.write(&dir).expect("write a support file");
        if file.compiled {
            runtime_sources.push(written);
        }
    }
    std::fs::write(dir.join("drive.c"), driver).expect("write the driver");

    // Reporting rather than a bool: a check that fails without saying why is
    // the thing this whole file exists to stop happening.
    let build = |args: &[&str], out: &str| -> Result<(), String> {
        let result = std::process::Command::new("clang")
            .args(["-w", "-O1"])
            .args(args)
            .arg("-I")
            .arg(&dir)
            .arg(dir.join("drive.c"))
            .arg("-lm")
            .arg("-o")
            .arg(dir.join(out))
            .output()
            .map_err(|error| error.to_string())?;
        if result.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).into_owned())
        }
    };
    let ll = dir.join("program.ll");
    let object = dir.join("program.o");
    let compiled_ir = std::process::Command::new("clang")
        .args(["-x", "ir", "-c", "-w"])
        .arg(&ll)
        .arg("-o")
        .arg(&object)
        .output()
        .is_ok_and(|out| out.status.success());
    assert!(compiled_ir, "clang rejected the emitted LLVM IR");
    // The runtime links into *both*, which is the arrangement that ships: one
    // hand-written C library, two code generators calling it. It is also the
    // only place the C-to-LLVM ABI is exercised.
    let program_c = dir.join("program.c");
    let runtime: Vec<&str> = runtime_sources.iter().filter_map(|p| p.to_str()).collect();

    let mut llvm_args = vec![object.to_str()?];
    llvm_args.extend(runtime.iter().copied());
    if let Err(problem) = build(&llvm_args, "run_llvm") {
        panic!("linking the IR against the runtime failed:\n{problem}");
    }
    let mut c_args = vec![program_c.to_str()?];
    c_args.extend(runtime.iter().copied());
    if let Err(problem) = build(&c_args, "run_c") {
        panic!("building the C failed:\n{problem}");
    }

    let read = |name: &str| -> String {
        let out = std::process::Command::new(dir.join(name))
            .output()
            .expect("the compiled program should run");
        assert!(out.status.success(), "{name} exited badly");
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    Some((read("run_llvm"), read("run_c")))
}

/// Arithmetic, comparison and control flow, over the hostile pool.
#[test]
fn the_two_backends_compute_the_same_numbers() {
    let source = r"
export function arithmetic(a: number, b: number): number {
  return a + b * 2 - a / 3;
}
export function ordering(a: number, b: number): number {
  if (a < b) { return -1; }
  if (a > b) { return 1; }
  if (a === b) { return 0; }
  return 7;
}
export function loops(n: number): number {
  let total = 0;
  let i = 0;
  while (i < 20) {
    total = total + i * n;
    i = i + 1;
  }
  return total;
}
";
    let driver = format!(
        r#"#include <stdio.h>
double arithmetic(double a, double b);
double ordering(double a, double b);
double loops(double n);
int main(void) {{
  double xs[] = {POOL};
  int count = (int)(sizeof xs / sizeof xs[0]);
  for (int i = 0; i < count; i++) {{
    printf("%a\n", loops(xs[i]));
    for (int j = 0; j < count; j++)
      printf("%a %a\n", arithmetic(xs[i], xs[j]), ordering(xs[i], xs[j]));
  }}
  return 0;
}}
"#
    );
    let Some((llvm, c)) = both_backends("scalar", source, &driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(
        llvm, c,
        "the two backends disagree, which is a backend bug by construction"
    );
}

/// Fields, at offsets nothing in the LLVM output could have got from clang.
///
/// This is what makes `nts_codegen_common::layout` load-bearing rather than
/// merely checked. The C backend writes `p->x` and lets clang place it; the IR
/// has no `p->x`, only `getelementptr i8, ptr %p, i64 24`, and the 24 came from
/// the layout engine. If the two disagreed about an offset they would read
/// different bytes of the same object, which is what this asks.
///
/// The driver hands over a **zeroed buffer** and never names a field itself.
/// It did, at first, and the struct it wrote out by hand was wrong: `y` is an
/// `int32_t` in the emitted layout, not a `double`, because specialization
/// narrows a field like any other value. A driver that assumes `number` means
/// `double` is asserting something this compiler does not promise -- so it
/// asserts nothing, and every field is reached through the program.
#[test]
fn the_two_backends_agree_about_where_a_field_is() {
    let source = r"
class Point {
  x: number;
  y: number;
  flag: boolean;

  constructor(x: number, y: number, flag: boolean) {
    this.x = x;
    this.y = y;
    this.flag = flag;
  }
}

export function fill(p: Point, x: number, y: number, flag: boolean): number {
  p.x = x;
  p.y = y;
  p.flag = flag;
  return p.x;
}
export function readX(p: Point): number { return p.x; }
export function readY(p: Point): number { return p.y; }
export function readFlag(p: Point): number { return p.flag ? 1 : 0; }
export function bump(p: Point, by: number): number {
  p.x = p.x + by;
  return p.x;
}
";
    let driver = r#"#include <stdio.h>
#include <stdbool.h>
#include "nts_runtime.h"
/* Room for any object this fixture can produce, zeroed and over-aligned. The
   driver never names a field: every one is written and read through the
   program, so nothing here assumes a layout. */
static _Alignas(16) unsigned char storage[128];
double fill(void *p, double x, double y, bool flag);
double readX(void *p);
double readY(void *p);
double readFlag(void *p);
double bump(void *p, double by);
int main(void) {
  double xs[] = {0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 1.0/0.0, 0.0/0.0, 9007199254740993.0};
  for (int i = 0; i < 9; i++) {
    for (int k = 0; k < 128; k++) storage[k] = 0;
    printf("%a", fill(storage, xs[i], xs[(i + 3) % 9], i % 2 == 0));
    printf(" %a %a %a", readX(storage), readY(storage), readFlag(storage));
    printf(" %a\n", bump(storage, xs[(i + 5) % 9]));
  }
  return 0;
}
"#;
    let Some((llvm, c)) = both_backends("fields", source, driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(
        llvm, c,
        "the backends read different bytes of the same object"
    );
}

/// Objects the program allocates itself, on the stack and on the heap.
///
/// Which needs a descriptor, and a descriptor is a struct the *runtime* reads.
/// It is emitted as LLVM's own struct type with the runtime's field types in
/// the runtime's order -- LLVM lays a struct out the way clang does, so the two
/// agree by construction and there is nothing here to get wrong by four bytes.
///
/// What goes in one is already shared: `cyclic_layouts` and `reference_fields`
/// are the middle end's and the offsets are the layout engine's. Only the
/// rendering belongs to a backend.
#[test]
fn the_two_backends_agree_about_objects_they_allocate() {
    let source = r"
class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  sum(): number {
    return this.x + this.y;
  }
}

// Does not escape, so it lives in the frame.
export function inTheFrame(a: number, b: number): number {
  const p = new Point(a, b);
  return p.sum() * 3 + p.x;
}

// Escapes into the array, so it is allocated.
export function onTheHeap(a: number, b: number): number {
  const held: Point[] = [];
  held.push(new Point(a, b));
  const first = held[0]!;
  return first.sum() - first.y;
}
";
    let driver = r#"#include <stdio.h>
double inTheFrame(double a, double b);
int main(void) {
  double xs[] = {0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 1.0/0.0, 0.0/0.0, 9007199254740993.0};
  for (int i = 0; i < 9; i++)
    for (int j = 0; j < 9; j++)
      printf("%a\n", inTheFrame(xs[i], xs[j]));
  return 0;
}
"#;
    let Some((llvm, c)) = both_backends("objects", source, driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(llvm, c, "the backends disagree about an object they built");
}

/// Module-scope storage, which outlives every call and so is neither a
/// parameter nor a block argument.
///
/// The C backend makes it `static` file-scope storage; this makes it an
/// `internal global`. Same reason in both: a name outside the program is a name
/// something outside can collide with.
#[test]
fn the_two_backends_agree_about_module_scope_state() {
    let source = r"
let total = 0;
let count = 0;

export function add(x: number): number {
  total = total + x;
  count = count + 1;
  return total;
}

export function mean(): number {
  if (count === 0) {
    return 0;
  }
  return total / count;
}

export function reset(): number {
  const was = total;
  total = 0;
  count = 0;
  return was;
}
";
    let driver = r#"#include <stdio.h>
double add(double x);
double mean(void);
double reset(void);
void module__init(void);
int main(void) {
  module__init();
  double xs[] = {0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 0.0/0.0, 9007199254740993.0};
  for (int i = 0; i < 8; i++) {
    printf("%a %a\n", add(xs[i]), mean());
    if (i % 3 == 2) printf("reset %a\n", reset());
  }
  return 0;
}
"#;
    let Some((llvm, c)) = both_backends("globals", source, driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(llvm, c, "the backends disagree about module-scope state");
}

/// Strings: literals, concatenation, length, code units and truthiness.
///
/// A literal is static storage with an immortal count, emitted as code *units*
/// rather than as an LLVM string constant -- an escape rule that is not
/// JavaScript's is a different string, and a wide literal is not bytes at all.
/// Both backends number the literal table the same way, so `nts_str_3` is the
/// same string in both outputs.
///
/// Truthiness is the interesting one: a string is falsy when it is absent *or*
/// empty, which is a short circuit, so it is a runtime call rather than
/// something either backend inlines and gets subtly different.
#[test]
fn the_two_backends_agree_about_strings() {
    let source = "
export function pick(n: number): string {
  return n > 0 ? \"alpha\" : \"beta\";
}
export function wide(n: number): string {
  return n > 0 ? \"\u{4e2d}\u{6587}\" : \"x\";
}
export function joined(n: number): number {
  const both = pick(n) + wide(n);
  return both.length * 10 + pick(n).length;
}
export function unitAt(n: number): number {
  const text = pick(n);
  return text.charCodeAt(0) + text.length;
}
export function emptyIsFalsy(n: number): number {
  const text = n > 0 ? \"\" : \"full\";
  return text ? 1 : 0;
}
";
    let driver = r#"#include <stdio.h>
double joined(double n);
double unitAt(double n);
double emptyIsFalsy(double n);
int main(void) {
  double xs[] = {0.0, 1.0, -1.0, 3.5, -0.0, 0.0/0.0};
  for (int i = 0; i < 6; i++)
    printf("%a %a %a\n", joined(xs[i]), unitAt(xs[i]), emptyIsFalsy(xs[i]));
  return 0;
}
"#;
    let Some((llvm, c)) = both_backends("strings", source, driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(llvm, c, "the backends disagree about a string");
}

/// Erased values, which is where the ABI is.
///
/// `NtsValue` is a tag beside a union of a double, a bool and a pointer:
/// sixteen bytes, and System V classifies them as two eightbytes. `clang -S
/// -emit-llvm` prints `define { i32, i64 } @f(i32 %0, i64 %1)` -- two scalars
/// in, a two-field struct out -- and the *second* eightbyte is `i64` rather
/// than `double` because the union holds a pointer. That is the detail a
/// careful reading gets wrong, which is why this was refused until clang was
/// asked and why it is tested across a call boundary rather than within one.
///
/// The payload holds the union's first member, the `double`, so an integer is
/// converted before it is stored -- the same conversion the C backend's
/// `nts_value_of_number(x)` performs.
#[test]
fn the_two_backends_agree_about_erased_values() {
    let source = r"
// Crossing a call boundary in both directions, which is the ABI.
function box(v: unknown): unknown {
  return v;
}

export function throughACall(n: number): string {
  const v: unknown = n;
  const back = box(v);
  return typeof back + String(typeof v);
}

export function eachKind(n: number): string {
  const number1: unknown = n;
  const flag: unknown = n > 0;
  const text: unknown = 'held';
  const nothing: unknown = undefined;
  const absent: unknown = null;
  return (
    typeof box(number1) +
    typeof box(flag) +
    typeof box(text) +
    typeof box(nothing) +
    typeof box(absent)
  );
}

export function readBack(n: number): number {
  const v: unknown = n;
  const w = box(v);
  return typeof w === 'number' ? (w as number) * 3 : -1;
}

// Each absence carries its own tag, which is the whole reason a union of both
// is erased rather than a pointer. Written as two bindings because a
// conditional whose type is `null | undefined` and nothing else has no
// representation at all -- a real refusal, and not the one being tested.
export function absentIsNotNull(n: number): number {
  const nothing: unknown = undefined;
  const absent: unknown = null;
  return (
    (nothing === undefined ? 1 : 0) +
    (absent === null ? 10 : 0) +
    (nothing === absent ? 100 : 0) +
    n * 0
  );
}
";
    let driver = r#"#include <stdio.h>
NtsString *throughACall(double n);
NtsString *eachKind(double n);
double readBack(double n);
double absentIsNotNull(double n);
static void show(NtsString *s) {
  for (unsigned i = 0; i < s->length; i++) putchar(nts_unit_fn(s, i));
  putchar('\n');
}
int main(void) {
  double xs[] = {0.0, 1.0, -1.0, 3.5, -0.0, 1e21, 0.0/0.0, 9007199254740993.0};
  for (int i = 0; i < 8; i++) {
    show(throughACall(xs[i]));
    show(eachKind(xs[i]));
    printf("%a %a\n", readBack(xs[i]), absentIsNotNull(xs[i]));
  }
  return 0;
}
"#;
    let driver = format!("#include \"nts_runtime.h\"\n{driver}");
    let Some((llvm, c)) = both_backends("erased", source, &driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(llvm, c, "the backends disagree about an erased value");
}

/// A bitwise operator whose operands are held as doubles.
///
/// `n | 0` is an integer operation, and the representation around it is not
/// always an integer: when the other arm of a branch can be NaN the join is a
/// double, so the `|` arrives with `Float` operands. The C backend has always
/// spelled that `(double)((int32_t)a | (int32_t)b)`. The LLVM backend had no
/// arm for it and declined the whole function — "the operator `BitOr` on this
/// representation" — so a program C compiled produced no LLVM module at all.
///
/// Found by `examples/module-numbers`, which is the first fixture to put a
/// `| 0` in a branch beside a NaN, and found *late*: the gate went green on the
/// run that had it, because the LLVM step scored exactly its floor and a
/// threshold reports a boolean while discarding which case moved.
#[test]
fn the_two_backends_agree_about_bitwise_operators_on_doubles() {
    let source = r"
export function orZero(n: number): number {
  // The join is a double because the first arm is NaN, so `n | 0` is a bitwise
  // operator on a floating point representation.
  const held = n === 0 ? 0 / 0 : n | 0;
  return held === held ? held : -1;
}

export function andMask(n: number): number {
  const held = n === 1 ? 1 / 0 : n & 0xffff;
  return held > 1e308 ? -2 : held;
}

export function xorFlip(n: number): number {
  const held = n === 2 ? 0 / 0 : n ^ 0x5555;
  return held === held ? held : -3;
}
";
    let driver = r#"#include <stdio.h>
double orZero(double n);
double andMask(double n);
double xorFlip(double n);
int main(void) {
  double xs[] = {0.0, 1.0, 2.0, -1.0, 3.5, -0.0, 1e21, 0.0/0.0, 1.0/0.0,
                 -2147483648.0, 2147483647.0, 4294967296.0, 9007199254740993.0};
  for (int i = 0; i < 13; i++) {
    printf("%a %a %a\n", orZero(xs[i]), andMask(xs[i]), xorFlip(xs[i]));
  }
  return 0;
}
"#;
    let Some((llvm, c)) = both_backends("float-bitwise", source, driver) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(!llvm.is_empty(), "the run produced nothing");
    assert_eq!(llvm, c, "the backends disagree about bitwise ops on doubles");
}
