// expect: NTS1001 `resolve`
//
// A settler used as a **value** rather than called. The corpus writes this
// about forty times:
//
//     promise.then(resolve, reject);
//     this.#callback = resolve;
//     unconsumedPromises.enqueue({ resolve, reject });
//     wake = resolve;
//     new Timeout(resolve, after, args, false, ref);
//
// # It is a different feature from capturing one
//
// `examples/a-promise-settler-in-a-closure` closed the *capture* case, and the
// way it did so is why this is still open: a closure capturing `resolve` takes
// the **promise** into its field and re-derives the settle from it. That works
// because the closure body is compiled here and can be taught to settle.
//
// Storing one needs a real function object -- something with a `call` another
// function can invoke without knowing what it is -- and the promise alone is
// not that. It would need a synthesised closure whose body settles: an entry
// in `collect_closures` with a generated body, in the shape `wraps` already
// uses for "a closure with no captures whose call forwards to `finish`", plus
// a branch in `lower_closure`.
//
// # Why it was not built alongside the capture fix
//
// The capture fix needed no new closure and no generated body -- it reuses the
// whole existing capture pipeline and adds one field to `Capture`. This needs
// the closure table to gain entries that correspond to no arrow in the source,
// and `closures` is built once by `collect_closures` and *cloned* into each
// `FuncBuilder`, so those entries have to be synthesised in the collector.
//
// Worth the separation: the capture case is 41 sites and was a bug wearing the
// wrong message; this is ~40 mentions of a genuinely absent capability.

export function stored(n: number): number {
  let held: ((v: number) => void) | null = null;
  const p = new Promise<number>((resolve) => {
    held = resolve;
  });
  return n;
}
