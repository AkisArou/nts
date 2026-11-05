/*---
description: "Array spread makes an independent asymmetric copy while retaining shallow generic values and signed zero."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-spread]
---*/

// Array spread makes an independent asymmetric copy while retaining shallow generic values and signed zero. Route: a constrained helper at number and record type arguments. Node prints construction-spread-array-generic:ok.
function inspect<T extends number | { id: number }>(first: T, second: T): void {
  const items: T[] = [first, second, first, second], result = [...items];
  assert.sameValue(result === items, false); assert.compareArray(result, [first, second, first, second]);
  assert.compareArray(items, [first, second, first, second]);
  assert.sameValue(Object.is(result[0], first), true); assert.sameValue(result[2] === first, true);
  items[0] = second; assert.compareArray(result, [first, second, first, second]);
  result[1] = first; assert.compareArray(items, [second, second, first, second]);
  const empty: T[] = [], copiedEmpty = [...empty];
  assert.compareArray(copiedEmpty, []); assert.sameValue(copiedEmpty === empty, false);
}
inspect<number>(-0, NaN);
const first = { id: 1 }, second = { id: 2 };
inspect<{ id: number }>(first, second);
console.log("construction-spread-array-generic:ok");
