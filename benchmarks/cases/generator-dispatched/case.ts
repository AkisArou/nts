// A generator walked through a **parameter**, so the resumption cannot be
// resolved statically.
//
// The sibling of `generator`, which walks one where it was made. The two differ
// in exactly one thing: there, the walk emits a direct call to the resumption;
// here it loads the resumption out of the object's descriptor and calls through
// it. Same body, same element count, same arithmetic. The gap between the two
// rows *is* the cost of the dispatch.
//
// Worth a row of its own because that cost is not the same on every lane. The
// JVM lane measured ART: no inline cache and **no free monomorphic case** -- a
// virtual call is 1.88x to 2.06x a field read whether one class implements the
// method or three -- against 1.02x on HotSpot for the monomorphic case. A single
// number from an x86 machine would say the dispatch is nearly free and be wrong
// about Android by about 2x. This row exists so the claim is a measurement on
// each lane rather than an extrapolation from one.
//
// `drain` takes the generator rather than making it, which is the point: a
// callee that made its own would have the concrete frame back and the walk
// would be direct again.
//
// **Two generators, and the second is reached.** One implementation lets any
// lane's optimiser prove the target and inline it, which would measure the
// direct call again under a different name. `downFrom` runs once against two
// thousand rounds of `upTo`, so it costs nothing measurable and the call site
// is not monomorphic. `ref.cpp` and `ref.java` are built the same way for the
// same reason.

function* upTo(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i * 3;
    i = i + 1;
  }
}

function* downFrom(limit: number): Generator<number, void, unknown> {
  let i = limit;
  while (i > 0) {
    yield i * 3;
    i = i - 1;
  }
}

function drain(g: Generator<number, void, unknown>): number {
  let total = 0;
  for (const value of g) {
    total = total + value;
  }
  return total;
}

export function work(seed: number): number {
  let total = 0;
  for (let round = 0; round < 2000; round++) {
    total = total + drain(upTo(seed + 200));
  }
  total = total + drain(downFrom(seed + 200));
  return total;
}

/** The input the harness calls `work` with. See `generator/case.ts`. */
export const seed = 5;
