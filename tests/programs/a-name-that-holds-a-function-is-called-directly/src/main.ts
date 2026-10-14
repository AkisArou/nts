// A module-scope name whose initializer names a function, called through the name.
// `lower_call` resolves which declaration such a call means, and then asked a
// *different* declaration whether this program defines it -- the checker's raw
// answer, which for a call through a variable of function type is the annotation.
// An annotation has no body, so the call was sent down the **native** path and the
// already-resolved name was treated as a C symbol: `foreign function `prod`'s
// parameter `t` ... a type with no native ABI`, for a TypeScript function defined
// two lines up.
//
// The arms are the three answers that path can give, because only one of them was
// wrong: a resolved declaration with a body (direct), one without (native, and
// correct -- `runtime/node`'s `export const now: () => Timestamp = nts_hrtime_ns`
// is that shape), and a name nothing settles (the value path).

function twice(n: number): number {
  return n * 2;
}

function thrice(n: number): number {
  return n * 3;
}

/** **The subject.** An annotated module-scope name holding a function. */
const annotated: (n: number) => number = twice;

export function throughAnnotated(n: number): number {
  return annotated(n);
}

/** The same at module scope, whose value a function then reads. */
const atModule = annotated(21);

export function computedAtModule(n: number): number {
  return atModule + n * 0;
}

/** **Control.** Unannotated: the checker resolves to `thrice` itself, and this
 * always compiled -- which is what made the annotation look irrelevant. */
const bare = thrice;

export function throughBare(n: number): number {
  return bare(n);
}

/** **Control.** A local of the same annotated shape, which lowers through the
 * closure path and never reached the decision at all. */
export function throughLocal(n: number): number {
  const local: (n: number) => number = twice;
  return local(n);
}

/** **Control.** Called directly, the shape that was never in doubt. */
export function directly(n: number): number {
  return twice(n) + thrice(n);
}
