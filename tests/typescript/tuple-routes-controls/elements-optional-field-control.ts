/*---
description: "Control for elements-optional-field; carry named slot fields and explicit tuple metadata."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-null-undefined, ts-unions]
---*/
// Replace the [number, string?] tuple with required first/second fields, count, present and logical array metadata; keep the field operation and exact observations.
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
class ElementsBox { value: ElementsTuple; constructor(value: ElementsTuple) { this.value = value; } }
const storage = new ElementsBox(make(rows[0]));
for (const row of rows) {
  const input = make(row); storage.value = input; const actual = storage.value;
  same(actual, input); check(actual, row);
}
same(checks, rows.length);
