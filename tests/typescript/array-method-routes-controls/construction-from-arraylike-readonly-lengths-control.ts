/*---
description: "Array.from turns a length-only object into dense own undefined entries for every requested position. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-objects, ts-object-type, ts-unknown, ts-null-undefined]
---*/

function localFrom<T>(source: ArrayLike<T>): T[] {
  const result: T[] = [], count = source.length <= 0 || source.length !== source.length ? 0 : source.length - source.length % 1;
  for (let index = 0; index < count; index++) result[index] = source[index];
  return result;
}
// Array.from turns a length-only object into dense own undefined entries for every requested position. Route: a readonly array of lengths passed through a declared object type. Node prints construction-from-arraylike-readonly-lengths:ok.
const sizes: readonly number[] = [0, 1, 2, 4];
for (const size of sizes) {
  const source: { length: number } = { length: size }, result: unknown[] = localFrom(source);
  assert.sameValue(result.length, size); assert.sameValue(result === source, false);
  assert.sameValue(0 in result, size > 0);
  for (let index = 0; index < size; index++) {
    assert.sameValue(index in result, true); assert.sameValue(result[index], undefined);
  }
  assert.sameValue(source.length, size); assert.sameValue(0 in source, false);
}
console.log("construction-from-arraylike-readonly-lengths:ok");
