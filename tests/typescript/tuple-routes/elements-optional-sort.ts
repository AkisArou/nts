/*---
description: "[number, string?] retains every slot through sort storage."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-arrow-functions, ts-null-undefined, ts-unions, ts-tuples, ts-tuple-optional]
---*/
// [number, string?] crosses sort storage; node keeps omitted, own undefined, empty and nonempty optional tails, with -0 and NaN in the required numeric slot, read by position.
interface ElementsRow { first: number; second: string | undefined; count: number; present: boolean; }
const rows: ElementsRow[] = [
  { first: -0, second: undefined, count: 1, present: false },
  { first: NaN, second: undefined, count: 2, present: true },
  { first: 2.5, second: "", count: 2, present: true },
  { first: -7, second: "tail", count: 2, present: true }
];
type ElementsTuple = [number, string?];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return row.present ? [row.first, row.second] : [row.first]; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(Array.isArray(value), true); same(value.length, expected.count);
  same(value[0], expected.first); same(value[1], expected.second);
  same(1 in value, expected.present); same(Object.hasOwn(value, 1), expected.present);
  checks++;
}
const storage: ElementsTuple[] = [], originals: ElementsTuple[] = [];
for (const row of rows) { const input = make(row); storage.push(input); originals.push(input); check(input, row); }
const sorted = storage.sort((a, b) => { const left = String(a[1]), right = String(b[1]); return a.length - b.length || (left < right ? -1 : left > right ? 1 : 0); });
same(sorted, storage); same(sorted.length, rows.length);
const order: number[] = [0, 2, 3, 1];
for (let i = 0; i < order.length; i++) { same(sorted[i], originals[order[i]]); check(sorted[i], rows[order[i]]); }
same(checks, rows.length * 2);
