// `ArrayBuffer`: bytes with a length, and the states a buffer can be in.
//
// A buffer carries no element type -- that is the whole difference between it
// and the views over it -- so it is `ManagedType::Buffer`, on the same terms
// `Date` and `Symbol` are their own managed types: one fixed runtime struct,
// nothing that varies with a payload.
//
// EVERY CASE HERE CATCHES. That is not defensive style, it is what makes the
// file worth running: an uncaught throw ends the process, and every case after
// it in the same run goes unasked -- which is record 0175's failure seen from
// the other side, where a smaller denominator read as a smaller problem.
// Catching turns each throw into an answer, so the run continues and the pool
// is actually exercised. The class is returned rather than swallowed, because
// `RangeError` and `TypeError` are different answers and the language picks
// between them deliberately.
//
// The length is `ToIndex`, which reads like one rule and is two: truncate
// toward zero, *then* require a non-negative integer below 2^53. Guarding the
// argument before truncating gets the boundary wrong, and node shows exactly
// where -- `new ArrayBuffer(-0.5)` is an empty buffer and `new ArrayBuffer(-1.5)`
// is a `RangeError`, because the first truncates to `-0` and the second to `-1`.
//
// The upper bound is the specification's 2^53 and not an allocation limit.
// Node refuses far earlier -- about 54.8 GB on the machine this was written on,
// and with a different message -- because that bound is how much memory it can
// get rather than anything the language says.

const RANGE = -1;
const TYPE = -2;
const OTHER = -3;

// A size that is about the language rather than about the machine.
//
// The pool holds 2^31 and 2^32-1, and a buffer that large is a question about
// how much memory is free rather than about ECMAScript: node answered 2^31
// correctly on its own and threw `RangeError: Array buffer allocation failed`
// for the same input inside this suite, because by then it had allocated a
// dozen more. Both sides would be flaky and neither would be wrong.
//
// So the size is capped and the *rule* boundaries pass through untouched:
// `NaN > 4096` is false, so NaN still reaches the constructor and still means
// zero; -1.5 still truncates to -1 and still throws; -0.5 still means zero.
// The one thing removed is the part that measures the machine.
function bounded(n: number): number {
  return n > 4096 ? 4096 : n;
}

function thrown(error: unknown): number {
  if (error instanceof RangeError) {
    return RANGE;
  }
  if (error instanceof TypeError) {
    return TYPE;
  }
  return OTHER;
}

export function length(n: number): number {
  try {
    return new ArrayBuffer(bounded(n)).byteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function maximum(n: number): number {
  try {
    return new ArrayBuffer(bounded(n)).maxByteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function fixedIsNotResizable(n: number): boolean {
  try {
    return new ArrayBuffer(bounded(n)).resizable;
  } catch (error) {
    return false;
  }
}

export function growableMaximum(n: number, max: number): number {
  try {
    return new ArrayBuffer(bounded(n), { maxByteLength: bounded(max) }).maxByteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function growableIsResizable(n: number, max: number): boolean {
  try {
    return new ArrayBuffer(bounded(n), { maxByteLength: bounded(max) }).resizable;
  } catch (error) {
    return false;
  }
}

export function sliced(n: number, from: number, to: number): number {
  try {
    return new ArrayBuffer(bounded(n)).slice(from, to).byteLength;
  } catch (error) {
    return thrown(error);
  }
}

// One argument means "to the end", and the end is whatever the buffer says.
export function slicedFrom(n: number, from: number): number {
  try {
    return new ArrayBuffer(bounded(n)).slice(from).byteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function transferredLength(n: number, to: number): number {
  try {
    return new ArrayBuffer(bounded(n)).transfer(bounded(to)).byteLength;
  } catch (error) {
    return thrown(error);
  }
}

// The other half of a transfer, and the half a test could miss: one that
// copied the bytes without detaching the source would pass every check that
// only looked at the result.
export function sourceIsDetached(n: number): boolean {
  try {
    const buffer = new ArrayBuffer(bounded(n));
    buffer.transfer();
    return buffer.detached;
  } catch (error) {
    return false;
  }
}

export function detachedLength(n: number): number {
  try {
    const buffer = new ArrayBuffer(bounded(n));
    buffer.transfer();
    return buffer.byteLength;
  } catch (error) {
    return thrown(error);
  }
}

// A detached buffer is a `TypeError` for `slice`, and zero for `byteLength`.
// Both are the specification and they disagree with each other on purpose.
export function detachedSlice(n: number): number {
  try {
    const buffer = new ArrayBuffer(bounded(n));
    buffer.transfer();
    return buffer.slice(0, 1).byteLength;
  } catch (error) {
    return thrown(error);
  }
}

// `transfer` keeps the resizable state and `transferToFixedLength` drops it.
// The pair is the test: either one alone passes if both were wired to the same
// helper with the flag ignored.
export function transferKeepsResizable(n: number, max: number): boolean {
  try {
    return new ArrayBuffer(bounded(n), { maxByteLength: bounded(max) }).transfer().resizable;
  } catch (error) {
    return false;
  }
}

export function fixedTransferDropsResizable(n: number, max: number): boolean {
  try {
    return new ArrayBuffer(bounded(n), { maxByteLength: bounded(max) }).transferToFixedLength()
      .resizable;
  } catch (error) {
    return false;
  }
}

export function resized(n: number, max: number, to: number): number {
  try {
    const buffer = new ArrayBuffer(bounded(n), { maxByteLength: bounded(max) });
    buffer.resize(bounded(to));
    return buffer.byteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function shrunkThenGrown(max: number, down: number, up: number): number {
  try {
    const buffer = new ArrayBuffer(4, { maxByteLength: bounded(max) });
    buffer.resize(bounded(down));
    buffer.resize(bounded(up));
    return buffer.byteLength;
  } catch (error) {
    return thrown(error);
  }
}

// A fixed buffer refuses `resize` with a `TypeError` rather than a
// `RangeError`: the receiver is wrong, not the length.
export function resizeFixed(n: number, to: number): number {
  try {
    const buffer = new ArrayBuffer(bounded(n));
    buffer.resize(bounded(to));
    return buffer.byteLength;
  } catch (error) {
    return thrown(error);
  }
}
