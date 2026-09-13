// TypeScript compiled into a C program. The native counterpart to
// `ts-from-java`, and like that one it **works today** -- because the output of
// this compiler is C, so a C program can simply call it.
//
// Every export below exists to demonstrate one row of the boundary's behaviour.
// `native/caller.c` calls the ones that work and documents the ones that do
// not; `docs/native-interop.md` carries the same list as prose.

// --- free: scalars, and no runtime at all ----------------------------------
//
// A program exporting ONLY these links without `nts_runtime.c`. Verified: see
// the README. This is the freestanding dialect.

/** `double add(double, double)`. */
export function add(a: number, b: number): number {
  return a + b;
}

/** `double clamp(double, double, double)`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- spot 1: names are mangled on collision, invisibly ----------------------
//
// This emits `bool bool_(bool)` -- a trailing underscore, because `bool` is
// taken in C. Nothing here says so, and a hand-written `bool` prototype links
// against nothing. The generated program.h declares the exact C symbol.
export function bool(v: boolean): boolean {
  return !v;
}

// --- spot 6: a class is a real C struct, and this is the good news ---------
//
// `NtsObj_Point *makePoint(double)`, with `typedef struct NtsObj_Point` and
// `_Static_assert`s on its size and every field offset -- so `p->x` is safe and
// a layout change breaks the build rather than the program.
export class Point {
  x = 0;
  y = 0;
  constructor(x: number) {
    this.x = x;
    this.y = x * 2;
  }
}
export function makePoint(n: number): Point {
  return new Point(n);
}

// --- spot 2: an anonymous object type gets a generated name ----------------
//
// This emits `double sumOf(NtsObj_Type25 *)`. The number comes from the
// frontend's type ordering: add an unrelated interface above this line and it
// becomes `Type26`. A C caller cannot write that name, and a header exporting
// it would pin an implementation detail into somebody's source.
export function sumOf(o: { a: number; b: number }): number {
  return o.a + o.b;
}

/** The same shape with a NAMED interface. Here to show the contrast in the
 *  emitted name -- NOT a recommendation: the generated header exports a stable
 *  alias for either form, so anonymous object types are fine to export. */
export interface Pair {
  a: number;
  b: number;
}
export function sumOfNamed(o: Pair): number {
  return o.a + o.b;
}

// --- spot 3: C can receive a managed value but cannot make one -------------
//
// `NtsString *greet(NtsString *)`. C can hold the result; it has no public
// constructor to build the argument, because the emitted code makes literals as
// a compile-time `static const struct { NtsHeader header; unsigned char data[] }`.
// So `caller.c` cannot call this, and that is the gap rather than an oversight.
export function greet(name: string): string {
  return "hi " + name;
}

/** The workaround available today: keep the managed value inside, and let the
 *  boundary stay scalar. This one C *can* call. */
export function greetLength(n: number): number {
  return ("hi " + String(n)).length;
}

// --- spot 5: a promise needs a checkpoint the caller must know about -------
//
// `NtsPromise *later(double)`. The caller does: call, `nts_checkpoint()`, then
// `nts_promise_state()` / `nts_promise_value()`. The generated header documents this sequence.
export async function later(n: number): Promise<number> {
  // The `await` is load-bearing for the demonstration: an `async` function with
  // no suspension is ALREADY SETTLED when it returns, so the checkpoint would
  // change nothing and the arm would prove nothing. The first version of this
  // file had exactly that bug and printed `state = 1` on both sides.
  const v = await Promise.resolve(n);
  return v + 1;
}

// --- spot 4: a generator hands back its frame -----------------------------
//
// `NtsObj_counted_frame *counted(double)` -- the suspension frame itself, with
// `state` and `yielded` fields whose offsets are `_Static_assert`ed, and NO
// exported `next`. So C holds a real object with no supported way to step it.
export function* counted(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}
