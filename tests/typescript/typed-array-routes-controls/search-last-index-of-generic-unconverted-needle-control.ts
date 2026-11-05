/*---
description: "LastIndexOf keeps fractional and out-of-kind needles unchanged while selecting the last duplicate. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-generics, ts-generic-constraints, ts-unions]
---*/

function localInt8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localUint8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localLastIndexOf<T extends number | bigint>(items: readonly T[], needle: T, ...starts: [number?]): number {
  let first = starts.length === 0 ? items.length - 1 : localInteger(starts[0] === undefined ? 0 : starts[0]);
  if (first >= items.length) first = items.length - 1; else if (first < 0) first += items.length;
  for (let i = first; i >= 0; i--) if (items[i] === needle) return i; return -1;
}
// LastIndexOf keeps fractional and out-of-kind needles unchanged while selecting the last duplicate. Route: a constrained helper called at signed-byte and unsigned-byte type arguments. Node prints search-last-index-of-generic-unconverted-needle:ok.
type SignedSamples = number[];
type UnsignedSamples = number[];
const needles: readonly number[] = [-1, 255, 511, -257, 1.9, 1, NaN, Infinity];
function inspect<T extends SignedSamples | UnsignedSamples>(data: T, expected: readonly number[]): void {
  for (let i = 0; i < needles.length; i++) assert.sameValue(localLastIndexOf(data, needles[i]), expected[i]);
}
inspect<SignedSamples>(localInt8Array([-1, 0, 1, -1]), [3, -1, -1, -1, -1, 2, -1, -1]);
inspect<UnsignedSamples>(localUint8Array([255, 0, 1, 255]), [-1, 3, -1, -1, -1, 2, -1, -1]);
console.log("search-last-index-of-generic-unconverted-needle:ok");
