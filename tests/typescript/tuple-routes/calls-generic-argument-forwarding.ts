/*---
description: "Generic tuple argument lists keep three callback signatures and their results distinct."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-generics, ts-generic-constraints, ts-rest-parameters, ts-spread, ts-function-types, ts-arrow-functions, ts-bigint]
---*/
// A constrained argument-list generic spreads three tuple layouts into callbacks; node preserves every argument, return value and reference identity.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function forward<A extends unknown[], R>(fn: (...args: A) => R, args: A): R { return fn(...args); }
for (const row of rows) {
  const pair: [number, string] = [row.num, row.text], flags: [boolean, bigint, number] = [false, 0n, row.num], single: [TuplePoint] = [row.ref];
  same(pair.length, 2); same(Array.isArray(pair), true); same(pair[0], row.num); same(pair[1], row.text);
  same(flags.length, 3); same(Array.isArray(flags), true); same(flags[0], false); same(flags[1], 0n); same(flags[2], row.num);
  same(single.length, 1); same(Array.isArray(single), true); same(single[0], row.ref);
  const a = forward((num: number, text: string) => { same(num, row.num); same(text, row.text); return num; }, pair);
  const b = forward((flag: boolean, big: bigint, num: number) => { same(flag, false); same(big, 0n); same(num, row.num); return big; }, flags);
  const c = forward((ref: TuplePoint) => { same(ref, row.ref); return ref; }, single);
  same(a, row.num); same(b, 0n); same(c, row.ref);
}
