/*---
description: "Array.of retains the order, types and repeated identity of mixed values read from static fields. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-objects, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localOf<T>(...values: T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < values.length; index++) result[index] = values[index];
  return result;
}
// Array.of retains the order, types and repeated identity of mixed values read from static fields. Route: two static fields with a declared value union. Node prints construction-of-static-fields:ok.
type OfValue = number | string | null | undefined | { id: number };
const marker = { id: 7 };
class OfStore { static first: OfValue = undefined; static second: OfValue = undefined; }
const rows: readonly [OfValue, OfValue][] = [[-0, NaN], ["", "x"], [marker, null], [undefined, marker]];
for (const [first, second] of rows) {
  OfStore.first = first; OfStore.second = second;
  const result = localOf<OfValue>(OfStore.first, OfStore.second, OfStore.first, OfStore.second);
  assert.compareArray(result, [first, second, first, second]);
  assert.sameValue(Object.is(result[0], first), true); assert.sameValue(Object.is(result[1], second), true);
  if (first === marker) assert.sameValue(result[2] === marker, true);
  assert.sameValue(OfStore.first, first); assert.sameValue(OfStore.second, second);
}
console.log("construction-of-static-fields:ok");
