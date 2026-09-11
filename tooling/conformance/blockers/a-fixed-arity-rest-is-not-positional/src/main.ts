// expect: lowers
//
// **This produces invalid HIR, and it does so with no generics anywhere.**
//
//     type OneArg = (...args: [number]) => number;
//     const f: OneArg = (k: number): number => k + 1;
//     f(2);
//
//     CallArgumentType { callee: "Closure0#call", at: 1,
//                        expected: Float { bits: 64 },
//                        found: Managed(Array(Int { bits: 32, signed: true })) }
//
// A rest parameter typed by a **fixed-length tuple is positional**:
// `(...args: [number]) => number` is the same type as `(a: number) => number`,
// which is why TypeScript accepts the plain arrow on the left. This compiler
// represents the first as *one array parameter* and the second as *one number
// parameter*, so the call gathers an array and hands it to a closure whose first
// parameter is a double.
//
// # Why it is a `lowers` guard
//
// Nothing refuses. The lowering completes and the verifier rejects the result,
// which is the honest place for it to be caught and the wrong place for it to be
// noticed. What this file asserts is that the program still lowers; the invalid
// HIR is what a reader should expect to see when running it by hand.
//
// # Attribution, because it was nearly got wrong
//
// Found while making a *generic* rest work, and at first read as having been
// caused by that work -- a bare-tuple arm added the same evening. It was not:
// checking out `HEAD`'s `lower.rs`, `decompose.rs` and `mod.rs` and rebuilding
// reproduces it byte for byte. The bare-tuple arm never sees this shape, because
// a homogeneous tuple already represents as an array before that code is
// reached.
//
// One build settled what two readings had not, and the rule it is an instance of
// is that a defect found *during* a change is not thereby caused by it.
//
// # What it blocks
//
// `blockers/a-generic-rest-forwarded-to-its-callback` bottoms out here.
// `nextTick<A extends unknown[]>(cb: (...args: A) => void, ...args: A)`
// instantiates `A` to a tuple, so `cb` becomes exactly the type above and the
// closures passed to it are ordinary arrows. Making the generic rest
// representable -- which is done -- moves the cone one link and lands on this.
//
// # What it would take
//
// Lower a rest parameter whose type is a fixed-length tuple as **N positional
// parameters**, not as one array. `given.length` is then a constant and
// `given[k]` is parameter `k`, both known at compile time. A union of tuples
// cannot be done this way -- it has no single arity, which is why
// `element_of_a_tuple_union` builds an array for that case and must go on doing
// so.
//
// That is a representation change to the signature layout, which both backends
// read, so it belongs with the Node and JVM lanes rather than in a unilateral
// commit.

type OneArg = (...args: [number]) => number;

export function restTypedCallback(n: number): number {
  const f: OneArg = (k: number): number => k + 1;
  return f(n & 3);
}

/** Control: the same closure behind a plain positional type. Lowers and runs. */
type Plain = (a: number) => number;
export function plainTypedCallback(n: number): number {
  const f: Plain = (k: number): number => k + 1;
  return f(n & 3);
}
