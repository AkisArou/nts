// `async` functions, in the shape that needs no suspension.
//
// An `async` function with no `await` in it is an ordinary function whose
// returns settle a promise. That is the whole of what this file exercises, and
// it is a real slice rather than a stepping stone: the promise is allocated on
// entry, every `return` settles it and hands it back, and the function's type
// is `Promise<T>` rather than `T`.
//
// What is *not* here is suspension. `await` is refused by name, and the state
// machine that would implement it is the next piece of work. See
// `examples/async-unsupported`.
//
// These are driven by `nts check`, which calls the function, runs the loop to
// quiescence on the deterministic host, and compares what the promise settled
// with against what node's `await` produces.

// A number payload: settled through `nts_promise_fulfill_number`.
export async function twice(n: number): Promise<number> {
  return n * 2;
}

// No payload. Falling off the end of an `async` function resolves it with
// `undefined`, which is the same path a bare `return` takes rather than a
// special case beside it.
export async function nothing(n: number): Promise<void> {
  const ignored = n * 2;
  if (ignored < 0) {
    return;
  }
}

// A reference payload: a different `fulfill`, chosen from the payload's
// representation. Getting that choice wrong is a *compile* error in the emitted
// C rather than a silent corruption, because a double cannot be passed where
// the runtime wants an `NtsHeader *`.
export async function describe(n: number): Promise<string> {
  return n > 0 ? "positive" : "negative";
}

// Several returns, so the promise is settled from more than one path and the
// allocation still happens once.
export async function classify(n: number): Promise<number> {
  if (n < 0) {
    return -1;
  }
  if (n === 0) {
    return 0;
  }
  return 1;
}

// A return from inside a loop, which is the path where the settle has to
// terminate the block it is in rather than fall through to the next one.
export async function firstOver(limit: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    if (i > limit) {
      return i;
    }
  }
  return -1;
}

// A settled promise really is settled: nothing is left pending, so the loop
// has nothing to run and the value is there the moment the call returns.
export async function immediate(n: number): Promise<number> {
  return n;
}
