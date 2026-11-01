/*---
description: "Control for elements-labeled-filter; carry named slot fields and explicit tuple metadata."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace the [amount: number, label: string, owner: ElementsPoint] tuple with first/second/third fields with count and logical array metadata, retaining the original object reference; keep the filter operation and exact observations.
interface ElementsPoint { id: number; }
interface ElementsRow { first: number; second: string; third: ElementsPoint; id: number; count: number; }
const zeroPoint: ElementsPoint = { id: -0 }, nanPoint: ElementsPoint = { id: NaN }, otherPoint: ElementsPoint = { id: 7 };
const rows: ElementsRow[] = [
  { first: -0, second: "z", third: zeroPoint, id: -0, count: 3 },
  { first: NaN, second: "", third: nanPoint, id: NaN, count: 3 },
  { first: 2.5, second: "a", third: otherPoint, id: 7, count: 3 },
  { first: -7, second: "m", third: zeroPoint, id: -0, count: 3 }
];
type ElementsTuple = { first: number; second: string; third: ElementsPoint; count: number; array: boolean; };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return { first: row.first, second: row.second, third: row.third, count: row.count, array: true }; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(value.array, true); same(value.count, expected.count);
  same(value.first, expected.first); same(value.second, expected.second); same(value.third, expected.third); same(value.third.id, expected.id);
  checks++;
}
const storage: ElementsTuple[] = [];
for (const row of rows) { const input = make(row); storage.push(input); check(input, row); }
const filtered = storage.filter(value => value.second.length > 0);
same(filtered.length, 3); same(storage.length, rows.length);
const order: number[] = [0, 2, 3];
for (let i = 0; i < order.length; i++) { same(filtered[i], storage[order[i]]); check(filtered[i], rows[order[i]]); }
same(checks, rows.length + 3);
