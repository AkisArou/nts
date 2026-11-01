/*---
description: "Control for calls-variadic-append-instantiations; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-generics, ts-bigint, ts-null-undefined]
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
type One<A> = { first: A; count: number; array: boolean };
function appendTwo<A, B, U>(value: Two<A, B>, tail: U) { return { first: value.first, second: value.second, third: tail, count: value.count + 1, array: value.array }; }
function appendOne<A, U>(value: One<A>, tail: U) { return { first: value.first, second: tail, count: value.count + 1, array: value.array }; }
function appendEmpty<U>(value: { count: number; array: boolean }, tail: U) { return { first: tail, count: value.count + 1, array: value.array }; }
for (const row of rows) {
  const pair: Two<number, string> = { first: row.num, second: row.text, count: 2, array: true }, flags: Two<boolean, bigint> = { first: false, second: 0n, count: 2, array: true };
  const reference: One<TuplePoint> = { first: row.ref, count: 1, array: true }, empty = { count: 0, array: true };
  same(pair.count, 2); same(pair.array, true); same(pair.first, row.num); same(pair.second, row.text);
  same(flags.count, 2); same(flags.array, true); same(flags.first, false); same(flags.second, 0n);
  same(reference.count, 1); same(reference.array, true); same(reference.first, row.ref);
  same(empty.count, 0); same(empty.array, true);
  const a = appendTwo(pair, row.ref), b = appendTwo(flags, row.num), c = appendOne(reference, undefined), d = appendEmpty(empty, row.text);
  same(a.count, 3); same(a.array, true); same(a.first, row.num); same(a.second, row.text); same(a.third, row.ref);
  same(b.count, 3); same(b.array, true); same(b.first, false); same(b.second, 0n); same(b.third, row.num);
  same(c.count, 2); same(c.array, true); same(c.first, row.ref); same(c.second, undefined);
  same(d.count, 1); same(d.array, true); same(d.first, row.text);
  same(Object.is(a, pair), false); same(Object.is(b, flags), false); same(Object.is(c, reference), false); same(Object.is(d, empty), false);
  same(pair.count, 2); same(flags.count, 2); same(reference.count, 1); same(empty.count, 0);
}
