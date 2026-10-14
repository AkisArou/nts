// run: check
//
// The control for a-negative-int32-element-read-as-unsigned: the same
// program, with one function more. throughAnArray stores the same int32 in a
// `number[]` and reads it back the same way. A `number[]` holding a negative
// value changes the program-wide fact about `number[]` elements that the
// typed array's read was given, so here every arm agrees, throughATypedArray
// included.
//
// It is the precondition a fix must keep: the defect is one fact reaching a
// view's read, and a fix that stopped narrowing `number[]` elements would
// pass the defect fixture and lose what this one shows still holds.
//
// Found writing the Wasm lane's buffer-views fixture (slice 3e).

export function throughATypedArray(v: number): number {
  const ints = new Int32Array(2);
  ints[0] = v * 1000000007;
  return ints[0]! % 4093;
}

export function throughAFloat64Array(v: number): number {
  const doubles = new Float64Array(2);
  doubles[0] = v * 1000000007;
  return doubles[0]! % 4093;
}

export function smallWholeNumbers(v: number): number {
  const values = [1, 2];
  return values[v > 0 ? 1 : 0]!;
}

export function throughAnArray(v: number): number {
  const ints: number[] = [0, 0];
  ints[0] = (v * 1000000007) | 0;
  return ints[0]! % 4093;
}
