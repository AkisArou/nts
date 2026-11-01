/*---
description: "Control for elements-optional-sort; carry named slot fields and explicit tuple metadata."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-arrow-functions, ts-null-undefined, ts-unions]
---*/
// Replace the [number, string?] tuple with required first/second fields, count, present and logical array metadata; keep the sort operation and exact observations.
interface ElementsRow { first: number; second: string | undefined; count: number; present: boolean; }
const rows: ElementsRow[] = [
  { first: -0, second: undefined, count: 1, present: false },
  { first: NaN, second: undefined, count: 2, present: true },
  { first: 2.5, second: "", count: 2, present: true },
  { first: -7, second: "tail", count: 2, present: true }
];
type ElementsTuple = { first: number; second: string | undefined; count: number; present: boolean; array: boolean; };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return { first: row.first, second: row.second, count: row.count, present: row.present, array: true }; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(value.array, true); same(value.count, expected.count);
  same(value.first, expected.first); same(value.second, expected.second);
  same(value.present, expected.present); same(value.present, expected.present);
  checks++;
}
const storage: ElementsTuple[] = [], originals: ElementsTuple[] = [];
for (const row of rows) { const input = make(row); storage.push(input); originals.push(input); check(input, row); }
const sorted = storage.sort((a, b) => { const left = String(a.second), right = String(b.second); return a.count - b.count || (left < right ? -1 : left > right ? 1 : 0); });
same(sorted, storage); same(sorted.length, rows.length);
const order: number[] = [0, 2, 3, 1];
for (let i = 0; i < order.length; i++) { same(sorted[i], originals[order[i]]); check(sorted[i], rows[order[i]]); }
same(checks, rows.length * 2);
