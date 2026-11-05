/*---
description: "Empty every is true and empty some is false without invoking either callback."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-bigint, ts-unions, ts-class, ts-class-fields, ts-static]
---*/

// Empty every is true and empty some is false without invoking either callback. Route: a static bigint array field and typed callbacks with both boolean answers. Node prints iteration-callback-empty-static:ok.
type Samples = BigInt64Array;
class EmptySource { static data: Samples = new BigInt64Array([]); }
for (const answer of [true, false]) {
  const log: (number | bigint | boolean)[] = [];
  const callback = (value: bigint, index: number, owner: Samples): boolean => { log.push(value, index, owner === EmptySource.data); return answer; };
  assert.sameValue(EmptySource.data.every(callback), true); assert.sameValue(EmptySource.data.some(callback), false);
  assert.compareArray(log, []);
}
console.log("iteration-callback-empty-static:ok");
