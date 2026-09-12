// Which `try` this compiler can answer, and which one it refuses.
//
// A `throw` is lowered as an edge to the handler's block. That edge exists
// inside one function, so a `throw` raised by a *callee* has nowhere to go: the
// callee ends the process through `nts_uncaught` and the caller's `catch` never
// runs. The C for it is the clearest statement of the defect --
//
//     double crossing(double v0) { v1 = deep(v0); return v1; }
//
// -- a `try`/`catch` compiled to neither, with no diagnostic. So the call is
// refused, and three shapes that are *not* broken have to keep compiling, which
// is what the rest of this file is.
//
// The four arms differ in the callee and in nothing else. Written apart, each
// would be a fixture for its own arm; written together, the one that refuses
// names what the other three have that it does not.

function raises(n: number): number {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

function pure(n: number): number {
  return n & 7;
}

async function rejecting(n: number): Promise<number> {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

// Refused: `raises` can throw, and the throw would leave its frame.
export function crossing(n: number): number {
  try {
    return raises(n);
  } catch {
    return -1;
  }
}

// Compiles. The throw and the handler are in one function, which is the
// commonest shape there is, and the edge is a branch.
export function sameFunction(n: number): number {
  try {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  } catch {
    return -1;
  }
}

// Compiles. A call inside a `try` is no worse than the same call outside one
// when the callee cannot raise, and refusing on "is it compiled code" alone
// took this shape away -- `examples/array-buffer` wraps `new ArrayBuffer(
// bounded(n))` in exactly this and lost six tests to it.
export function callingSomethingPure(n: number): number {
  try {
    return pure(n);
  } catch {
    return -1;
  }
}

// Compiles. An `async` function never raises synchronously: a `throw` in one
// rejects the promise it already returned, and that rejection *is* an edge into
// this handler -- see `examples/async-catch`, which is eight functions of it.
// Treating an async callee as a raise refused all eight.
export async function awaitingARejection(n: number): Promise<number> {
  try {
    return await rejecting(n);
  } catch {
    return -1;
  }
}
