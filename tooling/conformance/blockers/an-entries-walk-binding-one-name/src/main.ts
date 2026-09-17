// expect: NTS1001 `entries()` on this type, which needs the iteration protocol

// `for (const pair of xs.entries())` — one name over an array's entries.
//
// With **two** names this walks the array's own cursor: the index and the
// element, no iterator and no pair built. `examples/an-array-walked-with-its-
// index` carries that, along with `keys()` and `values()`.
//
// With **one** name the element *is* the `[index, element]` pair, which is a
// tuple this compiler does not build here, so it is refused.
//
// # Why this is a fixture rather than a note
//
// `sequence_source` folds `xs.entries()` back to `xs` before the arity is
// known — it has to, because that is what lets the two-name form be a counted
// loop rather than an allocated iterator. By the time anything can see that
// the head binds one name, the call is gone and the value in hand is the array
// itself. So the refusal is the *only* thing standing between this program and
// a loop that quietly walks elements and binds each to `pair`: right shape,
// wrong values, and no diagnostic.
//
// That makes a silent pass the failure mode to guard against, which is why the
// expectation names the message rather than merely asserting that something
// refused. A future change that starts answering this correctly should report
// FIXED here; one that refuses it for a different reason should report
// CHANGED, because the reason is what this fixture is about.

export function f(n: number): number {
  const xs = [1, 2, n];
  let total = 0;
  for (const pair of xs.entries()) {
    total += pair[0];
  }
  return total;
}
