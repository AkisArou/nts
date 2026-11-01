/*---
description: "[amount: number, label: string, owner: ElementsPoint] retains every slot through field storage."
features: [ts-tuple-routes, ts-tuple-route-elements, ts-functions, ts-typeof-operator, ts-unknown, ts-objects, ts-interfaces, ts-type-aliases, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-tuples, ts-tuple-labels]
---*/
// [amount: number, label: string, owner: ElementsPoint] crosses field storage; node keeps signed zero, NaN, empty and nonempty labels, and repeated or distinct object identities, read by position.
interface ElementsPoint { id: number; }
interface ElementsRow { first: number; second: string; third: ElementsPoint; id: number; count: number; }
const zeroPoint: ElementsPoint = { id: -0 }, nanPoint: ElementsPoint = { id: NaN }, otherPoint: ElementsPoint = { id: 7 };
const rows: ElementsRow[] = [
  { first: -0, second: "z", third: zeroPoint, id: -0, count: 3 },
  { first: NaN, second: "", third: nanPoint, id: NaN, count: 3 },
  { first: 2.5, second: "a", third: otherPoint, id: 7, count: 3 },
  { first: -7, second: "m", third: zeroPoint, id: -0, count: 3 }
];
type ElementsTuple = [amount: number, label: string, owner: ElementsPoint];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function make(row: ElementsRow): ElementsTuple { return [row.first, row.second, row.third]; }
let checks = 0;
function check(value: ElementsTuple, expected: ElementsRow): void {
  same(Array.isArray(value), true); same(value.length, expected.count);
  same(value[0], expected.first); same(value[1], expected.second); same(value[2], expected.third); same(value[2].id, expected.id);
  checks++;
}
class ElementsBox { value: ElementsTuple; constructor(value: ElementsTuple) { this.value = value; } }
const storage = new ElementsBox(make(rows[0]));
for (const row of rows) {
  const input = make(row); storage.value = input; const actual = storage.value;
  same(actual, input); check(actual, row);
}
same(checks, rows.length);
