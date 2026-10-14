// `function g({ a = 1 }: Opts = {}) {}`, called as `g()`.
//
// The options bag: a destructured parameter whose *whole* default is an empty
// object, so a caller may omit it entirely. Ordinary JavaScript, written on the
// first day of most programs, and it did not build.
//
// # What it did instead of refusing
//
// A parameter's default is materialised at the **call**, not in the callee, and
// `default_of` found it by locating the parameter's name among the children and
// taking the last child if it was something else. It looked for an `IDENTIFIER`.
// A destructured parameter's name is a *binding pattern*, so the search failed,
// the parameter was reported as having no default, and the call passed no
// argument at all.
//
// Nothing said so. The arity check lives in `verify`, so the whole program came
// out as
//
//     invalid HIR: CallArgumentCount { func: "f", callee: "g", expected: 1, found: 0 }
//     Error: refusing to emit code from invalid HIR
//
// and `emit-c` **exited 0** having written nothing. Not a refused function — a
// silently unbuilt program, which a refusal census cannot see and an exit status
// cannot either.
//
// # Why it lasted
//
// It needs three things at once: the parameter must be destructured, it must
// have a whole-parameter default, and some call must omit it. Each alone is
// fine, and all three of those are the controls below — `sum({ a: 1 })` on the
// same function, a plain `a = 1` default, and a destructured parameter with no
// default.
//
// **Those controls were verified as separate programs, and they had to be.**
// `invalid HIR` is not a refused function: the compiler emits *nothing at all*,
// so on the compiler before this the whole of this file fails to build,
// controls included. Running them here would say only that the file does not
// compile — which is the finding, not the control. Each was run alone against
// the old binary and each agreed with node.

interface Opts {
  a?: number;
  b?: number;
}

function sum({ a = 1, b = 2 }: Opts = {}): number {
  return a * 100 + b;
}

/** The shape that did not build: the argument omitted entirely. */
export function omitted(n: number): number {
  return sum() + n;
}

/** The same function called *with* an argument, which always worked — so this
 *  arm passes on both compilers and the one above does not. */
export function supplied(n: number): number {
  return sum({ a: n }) + sum({ a: n, b: n });
}

function pair([a, b]: [number, number] = [3, 4]): number {
  return a * 100 + b;
}

/** An **array** pattern, the other spelling of the same thing. */
export function arrayPatternOmitted(n: number): number {
  return pair() + pair([n, 1]);
}

function scaled({ a, b }: { a: number; b: number } = { a: 7, b: 8 }): number {
  return a * 100 + b;
}

/** A default that is not `{}`, so the filled value carries real fields. */
export function nonEmptyDefault(n: number): number {
  return scaled() + scaled({ a: n, b: 1 });
}

class Runner {
  factor = 3;

  run({ a = 1 }: { a?: number } = {}): number {
    return a * this.factor;
  }
}

/** A **method**, whose parameter list is read through the implementation rather
 *  than through a signature. */
export function throughAMethod(n: number): number {
  const r = new Runner();
  return r.run() + r.run({ a: n });
}

function required({ a, b }: { a: number; b: number }): number {
  return a * 100 + b;
}

/** Control: destructured, no default. Lowered before and after. */
export function destructuredWithoutADefault(n: number): number {
  return required({ a: n, b: 1 });
}

function plain(a: number = 1, b: number = 2): number {
  return a * 100 + b;
}

/** Control: a plain default, omitted. This is the path that always worked, and
 *  it is what says the fix is about the *name* and not about defaults. */
export function plainDefaultOmitted(n: number): number {
  return plain() + plain(n) + plain(n, n);
}

function optional(a: number, b?: number): number {
  return a * 100 + (b ?? 5);
}

/** Control: an optional parameter with no default at all, which fills with
 *  absence rather than with an expression. */
export function optionalOmitted(n: number): number {
  return optional(n) + optional(n, 1);
}
