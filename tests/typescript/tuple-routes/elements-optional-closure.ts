/*---
description: "[number, string?] retains every slot through closure storage."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-arrow-functions, ts-null-undefined, ts-unions, ts-tuples, ts-tuple-optional]
---*/
// [number, string?] crosses closure storage; node keeps omitted, own undefined, empty and nonempty optional tails, with -0 and NaN in the required numeric slot, read by position.
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
let saved = make(rows[0]);
const put = (value: ElementsTuple): void => { saved = value; }, read = (): ElementsTuple => saved;
for (const row of rows) {
  const input = make(row); put(input); const actual = read();
  same(actual, input); check(actual, row);
}
same(checks, rows.length);
