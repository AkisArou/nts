/*---
description: Control for narrowing-array-isarray-identity; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers]
---*/
// Pass a kind record with separate array and box fields, and branch on kind before reading the original reference.
interface NarrowBox { value: number; }
interface NarrowRow { kind: string; elementsExpected: number[]; boxExpected: number; list: number[]; box: NarrowBox; }
const rows: NarrowRow[] = [
  { kind: "array", elementsExpected: [-0, NaN], boxExpected: 81, list: [-0, NaN], box: { value: 81 } }, { kind: "box", elementsExpected: [82], boxExpected: -0, list: [82], box: { value: -0 } },
  { kind: "array", elementsExpected: [], boxExpected: 83, list: [], box: { value: 83 } }, { kind: "box", elementsExpected: [84], boxExpected: NaN, list: [84], box: { value: NaN } }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (value.kind === "array") {
    log.push("array"); same(value.list, expected.list); same(value.list.length, expected.elementsExpected.length);
    for (let i = 0; i < value.list.length; i++) same(value.list[i], expected.elementsExpected[i]);
  } else { log.push("box"); same(value.box, expected.box); same(value.box.value, expected.boxExpected); }
}
for (const row of rows) {
  const value: NarrowRow = { kind: row.kind, elementsExpected: row.elementsExpected, boxExpected: row.boxExpected, list: row.list, box: row.box };
  inspect(value, row);
}
assert.compareArray(log, ["array", "box", "array", "box"]);
