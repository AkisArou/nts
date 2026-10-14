// run: check
//
// A hole in an array of numbers or booleans reads as `undefined`, whatever
// the element type says. `new Array(n)` typed `number[]` is zero-filled
// (`ArrayNew { zeroed: true }`), and a double has no `undefined` to leave in
// a hole, so a read before a write answers 0 here:
// - `${xs[1]}` is "0" where node prints "undefined";
// - `xs[0] + xs[2]` is a number where node's is NaN;
// - a boolean hole is `false`.
//
// `T | null` holes are refused by name (a-hole-in-an-array-of-a-nullable-element);
// these kinds are not. Wasm refuses its own way: a typed array whose slots it
// cannot prove written before an observation.
//
// Each case has a control that differs in one thing: the slot it reads is
// written first, which agrees.
export function readAHole(n: number): string {
  const xs: number[] = new Array(3);
  xs[0] = n;
  return `${xs[1]}`;
}
export function readAWrittenSlot(n: number): string {
  const xs: number[] = new Array(3);
  xs[0] = n;
  xs[1] = n + 1;
  return `${xs[1]}`;
}
export function sumWithAHole(n: number): number {
  const xs: number[] = new Array(3);
  xs[0] = n;
  return xs[0] + xs[2];
}
export function sumOfWrittenSlots(n: number): number {
  const xs: number[] = new Array(3);
  xs[0] = n;
  xs[2] = 1;
  return xs[0] + xs[2];
}
export function aBooleanHole(n: number): string {
  const xs: boolean[] = new Array(2);
  xs[0] = n > 0;
  return `${xs[1]}`;
}
export function aWrittenBoolean(n: number): string {
  const xs: boolean[] = new Array(2);
  xs[0] = n > 0;
  xs[1] = n < 0;
  return `${xs[1]}`;
}
