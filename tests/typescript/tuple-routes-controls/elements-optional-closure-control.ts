/*---
description: "Control for elements-optional-closure; carry named slot fields and explicit tuple metadata."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-arrow-functions, ts-null-undefined, ts-unions]
---*/
// Replace the [number, string?] tuple with required first/second fields, count, present and logical array metadata; keep the closure operation and exact observations.
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
let saved = make(rows[0]);
const put = (value: ElementsTuple): void => { saved = value; }, read = (): ElementsTuple => saved;
for (const row of rows) {
  const input = make(row); put(input); const actual = read();
  same(actual, input); check(actual, row);
}
same(checks, rows.length);
