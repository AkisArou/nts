/*---
description: Array.isArray narrows an array-or-object union without copying either member.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-numbers]
---*/
// A number[]|NarrowBox parameter reaches Array.isArray; node retains array or object identity, empty length and exact -0/NaN elements.
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
function inspect(value: number[] | NarrowBox, expected: NarrowRow): void {
  if (Array.isArray(value)) {
    log.push("array"); same(value, expected.list); same(value.length, expected.elementsExpected.length);
    for (let i = 0; i < value.length; i++) same(value[i], expected.elementsExpected[i]);
  } else { log.push("box"); same(value, expected.box); same(value.value, expected.boxExpected); }
}
for (const row of rows) {
  const value: number[] | NarrowBox = row.kind === "array" ? row.list : row.box;
  inspect(value, row);
}
assert.compareArray(log, ["array", "box", "array", "box"]);
