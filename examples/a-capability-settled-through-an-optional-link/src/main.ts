// A promise capability settled through an optional link.
//
// `Promise.withResolvers()` is represented as its promise -- no layout, no
// allocation, no closure -- so `cap.resolve(v)` is a settle on that promise and
// `cap.promise` is the identity. That landed in 2026-09-16 and
// `examples/promise-with-resolvers` covers it.
//
// Every settle in that example is written `cap.resolve(v)`. The optional
// spelling `cap?.resolve(v)` refused, with a message about promises having no
// method table, because the settle was recognised **syntactically**: a callee
// that is a property access with exactly two children. `a?.b()` has three, the
// `?.` being a token of its own, so the shape fell past the recogniser and out
// the bottom of the method-call path.
//
// Nine distinct sites in `runtime/node` and `runtime/web-platform` are the
// optional spelling, all of one shape -- a queue of waiters, settled if there
// is one:
//
//     this.#writeRequests.dequeue()?.reject(this.#storedError)
//
// Teaching the syntactic recogniser about three children would have been the
// wrong fix. The settle has to happen **inside the present arm**, and that arm
// is built by `lower_optional_method_call`, which hands a *narrowed value* to
// `lower_method_on`. So both spellings now meet at `settle_lowered`, which
// takes a receiver that is already a value, and the capability test looks
// through a union with an absence -- a capability that may be missing is still
// a capability, and asking `named` of `PromiseWithResolvers<T> | undefined`
// answers nothing at all.
//
// The arms below pair each optional settle with its direct twin, because an
// example that only exercised the spelling under repair would pass on both
// compilers and measure nothing.

interface Waiter {
  readonly capability: PromiseWithResolvers<number> | undefined;
}

function waiting(n: number): Waiter {
  return { capability: n > 0 ? Promise.withResolvers<number>() : undefined };
}

// Direct, the spelling that already worked, as the control.
export async function settledDirectly(n: number): Promise<number> {
  const cap = Promise.withResolvers<number>();
  cap.resolve(n * 2);
  return await cap.promise;
}

// The shape this example exists for.
export async function settledThroughAnOptionalLink(n: number): Promise<number> {
  const cap = n > 0 ? Promise.withResolvers<number>() : undefined;
  cap?.resolve(n * 2);
  return cap === undefined ? -1 : await cap.promise;
}

// Rejection through the same link, which takes the other runtime helper.
export async function rejectedThroughAnOptionalLink(n: number): Promise<number> {
  const cap = n > 0 ? Promise.withResolvers<number>() : undefined;
  cap?.reject(new Error("refused"));
  if (cap === undefined) {
    return -1;
  }
  try {
    return await cap.promise;
  } catch {
    return n * 3;
  }
}

// Read through a field rather than a local, which is the corpus's shape: the
// capability is stored by whoever made it and settled by somebody else.
export async function settledThroughAField(n: number): Promise<number> {
  const waiter = waiting(n);
  waiter.capability?.resolve(n + 7);
  return waiter.capability === undefined ? -1 : await waiter.capability.promise;
}

// The argument must not be evaluated when the receiver is absent. Without this
// arm the two paths differ only in a number, and a settle that ran on the
// absent side could still produce the right one.
let calls = 0;

function payload(n: number): number {
  calls += 1;
  return n * 2;
}

export async function theArgumentIsNotEvaluatedWhenAbsent(n: number): Promise<number> {
  calls = 0;
  const cap = n > 0 ? Promise.withResolvers<number>() : undefined;
  cap?.resolve(payload(n));
  const got = cap === undefined ? -1 : await cap.promise;
  return got * 100 + calls;
}

// A settle with no argument, which is the `void` capability the streams code
// uses for "this step is done" rather than for a value.
export async function settledWithNothing(n: number): Promise<number> {
  const cap = n > 0 ? Promise.withResolvers<void>() : undefined;
  cap?.resolve();
  if (cap === undefined) {
    return -1;
  }
  await cap.promise;
  return n;
}
