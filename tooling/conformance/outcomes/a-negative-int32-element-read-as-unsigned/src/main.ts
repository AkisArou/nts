// run: check
//
// A negative element read from an Int32Array, taken modulo a constant, is
// computed as unsigned when the program also holds a `number[]` literal of
// small whole numbers, anywhere. throughATypedArray(3) is 0 on Wasm where
// node says -3470, and C answers wrongly too, with nothing refused.
//
// The prepared HIR computes `ints[0] % 4093` as `rem ... : u32`, converting
// the element to u32 first; without `smallWholeNumbers` in the program it is
// `rem ... : f64` and agrees. So a program-wide fact about `number[]`
// elements reaches a read of a typed array's, which the store of a negative
// value (`ints[0] = v * 1000000007`, through `nts_to_int32`) never fed.
//
// The control differs in one thing: throughAFloat64Array stores and reads
// the same value through a Float64Array, and agrees.
//
// The `number[]` control cannot share this program, because it removes the
// precondition: it is a-negative-int32-element-read-as-unsigned-control, the
// same program with a `number[]` holding the negative int32, where every arm
// agrees. Without `smallWholeNumbers`, the read is `rem ... : f64` and agrees.
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
