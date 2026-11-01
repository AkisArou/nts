/*---
description: "Control for calls-generic-argument-forwarding; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-generics, ts-function-types, ts-arrow-functions, ts-bigint]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type Two<A, B> = { first: A; second: B; count: number; array: boolean };
type Three<A, B, C> = { first: A; second: B; third: C; count: number; array: boolean };
type One<A> = { first: A; count: number; array: boolean };
function forwardTwo<A, B, R>(fn: (first: A, second: B) => R, value: Two<A, B>): R { return fn(value.first, value.second); }
function forwardThree<A, B, C, R>(fn: (first: A, second: B, third: C) => R, value: Three<A, B, C>): R { return fn(value.first, value.second, value.third); }
function forwardOne<A, R>(fn: (first: A) => R, value: One<A>): R { return fn(value.first); }
for (const row of rows) {
  const pair: Two<number, string> = { first: row.num, second: row.text, count: 2, array: true }, flags: Three<boolean, bigint, number> = { first: false, second: 0n, third: row.num, count: 3, array: true }, single: One<TuplePoint> = { first: row.ref, count: 1, array: true };
  same(pair.count, 2); same(pair.array, true); same(pair.first, row.num); same(pair.second, row.text);
  same(flags.count, 3); same(flags.array, true); same(flags.first, false); same(flags.second, 0n); same(flags.third, row.num);
  same(single.count, 1); same(single.array, true); same(single.first, row.ref);
  const a = forwardTwo((num: number, text: string) => { same(num, row.num); same(text, row.text); return num; }, pair);
  const b = forwardThree((flag: boolean, big: bigint, num: number) => { same(flag, false); same(big, 0n); same(num, row.num); return big; }, flags);
  const c = forwardOne((ref: TuplePoint) => { same(ref, row.ref); return ref; }, single);
  same(a, row.num); same(b, 0n); same(c, row.ref);
}
