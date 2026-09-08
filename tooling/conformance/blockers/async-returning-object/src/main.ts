// expect: emit-c --napi -> compiles
//
// **FIXED in ac27dac4-era, kept as a guard.** The emitted C compiles. That is the whole guard: this fixture was
// filed because it did not.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// **The expectation names a clang error, not a string in `program.c`.** It said
// `emits-c <text>` and that is a substring match: a fragment taken from broken
// output can also occur in correct output, and this one did. It reported
// `reproduces` after the defect was fixed, and would have gone on doing so.
//
// An `async` function that resolves to an object emits an uncast call to the
// runtime, and clang rejects it:
//
//     program.c:39  nts_promise_fulfill_tagged(v1, v4, v29);
//     error: incompatible pointer types passing 'NtsArray *' to parameter of
//            type 'NtsHeader *'
//
// The runtime's signature is already right --
//
//     void nts_promise_fulfill_tagged(NtsPromise *promise, NtsHeader *value, ...)
//
// -- so this is not the `callback-binding` shape, where a hand-written header
// named a per-program type. Here both sides agree on `NtsHeader *` and the
// **call site is emitted without the cast**. A concrete object pointer is passed
// straight into a parameter typed as the base header.
//
// Seven lines to reproduce, nothing refused, and the wrapper is published. Two
// errors from two functions, so it is one per resolution rather than one per
// program.
//
// Reach: it is the whole of `stream`'s `incompatible pointer types` count, and
// the same shape appears with `NtsObj_MemoryCacheStorageHandle *` there -- so it
// is any object, not arrays specifically. An `async` function resolving to
// anything that is not a number is a common enough shape that this is likely to
// be behind more than the modules it has been counted in.
//
// Found while chasing a fourth wrong hypothesis about `Closure54__call`. That
// is the third fixture today produced by a guess that turned out to be about
// something else.

export async function numbers(): Promise<number[]> {
  return [1, 2, 3];
}

export async function strings(): Promise<string[]> {
  return ["a", "b"];
}

export function touch(): number {
  return 1;
}
