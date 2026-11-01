/*---
description: "[string, ...number[]] retains every slot through sort storage."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-arrow-functions, ts-tuples, ts-tuple-rest]
---*/
// [string, ...number[]] crosses sort storage; node keeps zero, one and three numeric rest values, including -0, NaN, fractions and a value above 2^31, read by position.
interface ElementsRow { first: string; second: number; third: number; fourth: number; count: number; }
const rows: ElementsRow[] = [
  { first: "empty", second: 91, third: 92, fourth: 93, count: 1 },
  { first: "", second: -0, third: 92, fourth: 93, count: 2 },
  { first: "many", second: NaN, third: 2.5, fourth: -3, count: 4 },
  { first: "wide", second: 2147483648, third: -0, fourth: NaN, count: 4 }
];
type ElementsTuple = [string, ...number[]];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return row.count === 1 ? [row.first] : row.count === 2 ? [row.first, row.second] : [row.first, row.second, row.third, row.fourth]; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(Array.isArray(value), true); same(value.length, expected.count);
  same(value[0], expected.first);
  for (let i = 1; i < value.length; i++) same(value[i], i === 1 ? expected.second : i === 2 ? expected.third : expected.fourth);
  checks++;
}
const storage: ElementsTuple[] = [], originals: ElementsTuple[] = [];
for (const row of rows) { const input = make(row); storage.push(input); originals.push(input); check(input, row); }
const sorted = storage.sort((a, b) => { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
same(sorted, storage); same(sorted.length, rows.length);
const order: number[] = [1, 0, 2, 3];
for (let i = 0; i < order.length; i++) { same(sorted[i], originals[order[i]]); check(sorted[i], rows[order[i]]); }
same(checks, rows.length * 2);
