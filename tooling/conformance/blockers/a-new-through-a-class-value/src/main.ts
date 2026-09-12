// expect: which holds a class rather than naming one
//
// `new C(...)` where `C` is a **value holding a class** rather than a name the
// compiler can see.
//
// # This was a wrong answer that ran, until 2026-09-12
//
// The lowering took the constructed type from the *expression's* type, which the
// checker takes from the callee's declared type. For `function make(C: typeof
// Thing)`, `new C(n)` is typed `Thing`, so it built a `Thing` and called
// `Thing__constructor` -- and discarded the class argument outright:
//
//     static int32_t make(NtsObj_Fn2__1 * v0, int32_t v1) {
//         (void)v0;
//         v2_frame.header.descriptor = &nts_desc_NtsObj_Thing__Thing;
//         Thing__constructor(v2, v1);
//
// With one class reaching the site that is correct, which is exactly why it was
// invisible. A second class assignable to the same declared type is constructed
// **as the first**, at the first's size, running the first's constructor.
// `Other`'s constructor was never emitted at all, and its descriptor was
// `sizeof(NtsObj_Thing)` under the name `"Other"`.
//
// Two classes through one `make` disagreed with node on **18 of 58 cases** and
// produced a number for every one of them.
//
// # It was already the documented intent
//
// The class-token lowering says so in its own comment: "`new` through such a
// value is a separate feature and still refuses, as `a computed constructor`".
// It did refuse a *computed* callee -- `new things[0]()` has no identifier text.
// A **named** binding has text, so it slipped past the check and was resolved by
// name instead. The refusal now matches what the comment always claimed.
//
// # What building it needs
//
// The token exists: `CONSTRUCTOR_TOKENS` gives one immortal object per class,
// the same one wherever the name is written. What it has no room for is a way to
// *call* one -- the token would have to carry the instance descriptor (for the
// size and the tracing) and the constructor itself, which is the generator's
// resumption slot with a different member.
//
// # The controls
//
// `ordinary` names its class directly and must keep working; `comparedOnly`
// holds a class in a value and never constructs it, which is the half that does
// work -- `value === Error` is green in the ledger and `err.constructor` is not.
// If either control refuses, this fixture is about something else.

class Thing {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

class Other {
  n: number;
  constructor(n: number) {
    this.n = n * 2;
  }
}

/** Control: a `new` on a class named directly. */
export function ordinary(n: number): number {
  return new Thing(n & 7).n;
}

/** Control: a class held in a value and compared, never constructed. */
export function comparedOnly(n: number): number {
  const C = Thing;
  return C === Thing ? (n & 7) : 0;
}

function make(C: typeof Thing, n: number): number {
  return new C(n).n;
}

/** Under test: one class reaches the site, which used to be correct. */
export function oneClass(n: number): number {
  return make(Thing, n & 7);
}

/**
 * Under test, and the arm that made it visible: **two** classes reach one site.
 * Differs from `oneClass` in nothing else. A lowering that resolves the
 * constructor from the declared type answers `Thing` for both and still runs.
 */
export function twoClasses(n: number): number {
  return make(Thing, n & 7) * 100 + make(Other, n & 7);
}
