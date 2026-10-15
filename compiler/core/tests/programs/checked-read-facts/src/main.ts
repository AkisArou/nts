export function unboundedByte(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  return bytes[index | 0]! * 0;
}

export function boundedArray(index: number): number {
  const values = [7, 8];
  return values[(index | 0) & 1]! * 0;
}

export function ordinaryArray(index: number): number {
  const values = [7, 8];
  return values[index | 0]! * 0;
}

export function unusedRead(index: number): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 7;
  bytes[index | 0];
  return 7;
}

// Every element is zero, so the read's value is a single constant: folding it
// to `0` would drop the read, and with it the refusal an unproven index owes.
export function allZero(index: number): number {
  const zeros = new Uint8Array(4);
  return zeros[index | 0]!;
}

// A hole in an assignment pattern occupies a position and reads nothing, so
// `[,] = []` has no read to stop at. Only `b` is read here.
export function holeInAssignment(n: number): number {
  const xs: number[] = n > 0 ? [n, 2] : [];
  let b = 0;
  [, b] = xs.length > 1 ? xs : [0, 0];
  [,] = xs;
  return b;
}

// A rest reads its own tail: nothing reads the rest's position as an element,
// so a rest past the end has nothing to stop at either. Only `a` is read.
export function restInAssignment(n: number): number {
  const xs = [n];
  let a = 0;
  let rest: number[] = [];
  [a, ...rest] = xs;
  return a + rest.length;
}

// An assignment whose value is a read is not a discarded read: the read is the
// last operation the statement emits, and `v` names it.
export function assignedRead(index: number): number {
  const values = [7, 8];
  let v = 0;
  if (index > 0) v = values[index | 0]!;
  return v;
}

// A read of a `void` element answers `undefined` in range or out, so it never
// needs to stop, and a read nothing uses is removed. FormData's constructor is
// this shape; kept, it was a load of type `void` LLVM does not assemble.
export function voidElement(...args: [] | [form: undefined]): number {
  if (args.length !== 0 && args[0] !== undefined) return -1;
  return args.length;
}
