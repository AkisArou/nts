// expect: NTS1001 a `Box` where a `Box` is wanted
//
// **The same type name on both sides of the cast.** Two instantiations of one
// generic class -- `Box<number>` and `Box<bigint>` -- reached through an
// overloaded function whose implementation returns the union of them. `V` is a
// double in one layout and a bigint in the other, so the two `Box`es have
// different layouts and the diagnostic can only print one name for both.
//
// # Where it bites
//
// `runtime/node/fs/src/main.ts:703`, and it is node's documented API rather
// than anything avoidable:
//
//     export function statfsSync(p, o: { bigint: true }): StatFs<bigint>;
//     export function statfsSync(p, o?: StatFsOptions): StatFs<number>;
//     export function statfsSync(p, o?): StatFs<number> | StatFs<bigint> { … }
//
// `statfsSync(path, { bigint: true })` really does answer bigint columns and
// `statfsSync(path)` really does answer numbers. The overload pair is the
// contract, the union is the only implementation signature TypeScript accepts
// for it, and `StatFs<Value extends number | bigint>` is one class because node
// has one class.
//
// # Two reductions that did not reproduce, and what they rule out
//
// Recorded because each looked like the answer and cost a build to disprove:
//
//     Box<number> | Box<bigint> returned from `new`            crosses
//     the same, returned from a helper's call                  crosses
//     the same, behind two overload signatures                 REFUSED
//
// So it is **not** the union return, and **not** the call boundary. It is the
// overloads. That is the second time tonight a refusal turned on overload
// signatures -- `os.userInfo` was the first -- and in both the union return
// type was the thing that looked guilty and was not.
//
// # What this is not
//
// It is not `duplicate-type-name`. There is exactly one `StatFs` declared in
// the tree, at `fs/src/stats.ts:193`, and exactly one `Box` here. Two
// *instantiations* of one generic are not two declarations, and a census
// grepping for a repeated name would find nothing.

interface Opts {
  bigint?: boolean;
}

class Box<V extends number | bigint = number> {
  a: V;
  b: V;
  c: V;
  d: V;
  constructor(a: V, b: V, c: V, d: V) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
}

function makeNumber(): Box<number> {
  return new Box<number>(1, 2, 3, 4);
}

function makeBig(): Box<bigint> {
  return new Box<bigint>(1n, 2n, 3n, 4n);
}

/** The reduction: overloads returning two instantiations of one generic. */
export function boxed(o: { bigint: true }): Box<bigint>;
export function boxed(o?: Opts): Box<number>;
export function boxed(o?: Opts): Box<number> | Box<bigint> {
  if (o?.bigint === true) return makeBig();
  return makeNumber();
}

/** Control: the union returned from `new`, with no overloads. */
export function viaNew(big: boolean): Box<number> | Box<bigint> {
  if (big) return new Box<bigint>(1n, 2n, 3n, 4n);
  return new Box<number>(1, 2, 3, 4);
}

/** Control: the union returned from a helper call, with no overloads. */
export function viaHelper(big: boolean): Box<number> | Box<bigint> {
  if (big) return makeBig();
  return makeNumber();
}
