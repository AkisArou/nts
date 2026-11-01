/*---
description: "[string, ...number[]] retains every slot through closure storage."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-arrow-functions, ts-tuples, ts-tuple-rest]
---*/
// [string, ...number[]] crosses closure storage; node keeps zero, one and three numeric rest values, including -0, NaN, fractions and a value above 2^31, read by position.
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
let saved = make(rows[0]);
const put = (value: ElementsTuple): void => { saved = value; }, read = (): ElementsTuple => saved;
for (const row of rows) {
  const input = make(row); put(input); const actual = read();
  same(actual, input); check(actual, row);
}
same(checks, rows.length);
