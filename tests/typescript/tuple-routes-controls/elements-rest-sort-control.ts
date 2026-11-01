/*---
description: "Control for elements-rest-sort; carry named slot fields and explicit tuple metadata."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace the [string, ...number[]] tuple with first/second/third/fourth fields with an explicit active count and logical array metadata; keep the sort operation and exact observations.
interface ElementsRow { first: string; second: number; third: number; fourth: number; count: number; }
const rows: ElementsRow[] = [
  { first: "empty", second: 91, third: 92, fourth: 93, count: 1 },
  { first: "", second: -0, third: 92, fourth: 93, count: 2 },
  { first: "many", second: NaN, third: 2.5, fourth: -3, count: 4 },
  { first: "wide", second: 2147483648, third: -0, fourth: NaN, count: 4 }
];
type ElementsTuple = { first: string; second: number; third: number; fourth: number; count: number; array: boolean; };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return { first: row.first, second: row.second, third: row.third, fourth: row.fourth, count: row.count, array: true }; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(value.array, true); same(value.count, expected.count);
  same(value.first, expected.first);
  for (let i = 1; i < value.count; i++) same(i === 1 ? value.second : i === 2 ? value.third : value.fourth, i === 1 ? expected.second : i === 2 ? expected.third : expected.fourth);
  checks++;
}
const storage: ElementsTuple[] = [], originals: ElementsTuple[] = [];
for (const row of rows) { const input = make(row); storage.push(input); originals.push(input); check(input, row); }
const sorted = storage.sort((a, b) => { return a.first < b.first ? -1 : a.first > b.first ? 1 : 0; });
same(sorted, storage); same(sorted.length, rows.length);
const order: number[] = [1, 0, 2, 3];
for (let i = 0; i < order.length; i++) { same(sorted[i], originals[order[i]]); check(sorted[i], rows[order[i]]); }
same(checks, rows.length * 2);
