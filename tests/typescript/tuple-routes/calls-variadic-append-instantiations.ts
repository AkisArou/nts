/*---
description: "Variadic append preserves four source layouts and the appended value in its new last slot."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-variadic-tuples, ts-generics, ts-generic-constraints, ts-spread, ts-bigint, ts-null-undefined]
---*/
// [...T,U] appends to number/string, boolean/bigint, reference and empty tuples; node creates independent arrays with each original slot followed by U.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function append<T extends unknown[], U>(values: T, tail: U): [...T, U] { return [...values, tail]; }
for (const row of rows) {
  const pair: [number, string] = [row.num, row.text], flags: [boolean, bigint] = [false, 0n];
  const reference: [TuplePoint] = [row.ref], empty: [] = [];
  same(pair.length, 2); same(Array.isArray(pair), true); same(pair[0], row.num); same(pair[1], row.text);
  same(flags.length, 2); same(Array.isArray(flags), true); same(flags[0], false); same(flags[1], 0n);
  same(reference.length, 1); same(Array.isArray(reference), true); same(reference[0], row.ref);
  same(empty.length, 0); same(Array.isArray(empty), true);
  const a = append(pair, row.ref), b = append(flags, row.num), c = append(reference, undefined), d = append(empty, row.text);
  same(a.length, 3); same(Array.isArray(a), true); same(a[0], row.num); same(a[1], row.text); same(a[2], row.ref);
  same(b.length, 3); same(Array.isArray(b), true); same(b[0], false); same(b[1], 0n); same(b[2], row.num);
  same(c.length, 2); same(Array.isArray(c), true); same(c[0], row.ref); same(c[1], undefined);
  same(d.length, 1); same(Array.isArray(d), true); same(d[0], row.text);
  same(Object.is(a, pair), false); same(Object.is(b, flags), false); same(Object.is(c, reference), false); same(Object.is(d, empty), false);
  same(pair.length, 2); same(flags.length, 2); same(reference.length, 1); same(empty.length, 0);
}
