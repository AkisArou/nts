// run: check
//
// A `null` stored in a `(T | null)[]` and read through an index that may name
// no element answers `undefined` where node answers `null`: nullPoint(1) and
// nullString(1) are 1, node's 2, on C, LLVM and the JVM, with nothing refused. The array's
// storage keeps the reference and drops which absence the slot held, the read
// tells `undefined` apart through `nts_array_element`, and the runtime maps a
// null reference slot to `undefined`.
//
// tsconfig.json sets `noUncheckedIndexedAccess` because the defect needs it:
// with it, a read that may name no element tells `undefined` apart from a
// stored value through `nts_array_element`; without it, the read is a plain
// typed load and keeps the null.
//
// The control differs in one thing: undefinedString stores `undefined` in a
// `(string | undefined)[]`, the same null slot, and agrees.
//
// Found writing `nts_array_element` for the Wasm lane, which refuses a null
// slot by name rather than guess which absence it held.
//
// Fixed in the lowering: `nts_array_element` is told which absence a null
// slot holds, read off the element type (`null_slot`). The record now pins
// the agreement.
class Point {
  constructor(readonly x: number) {}
}
export function nullPoint(at: number): number {
  const xs: (Point | null)[] = [new Point(1), null];
  const v = xs[at];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
export function nullString(at: number): number {
  const xs: (string | null)[] = ["a", null];
  const v = xs[at];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
export function undefinedString(at: number): number {
  const xs: (string | undefined)[] = ["a", undefined];
  const v = xs[at];
  return v === undefined ? 1 : 3;
}
