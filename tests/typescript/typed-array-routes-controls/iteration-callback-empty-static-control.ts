/*---
description: "Empty every is true and empty some is false without invoking either callback. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-bigint, ts-unions, ts-class, ts-class-fields, ts-static]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localEvery(data: bigint[], callback: (value: bigint, index: number, owner: bigint[]) => boolean): boolean { for (let i = 0, length = data.length; i < length; i++) if (!callback(data[i], i, data)) return false; return true; }
function localSome(data: bigint[], callback: (value: bigint, index: number, owner: bigint[]) => boolean): boolean { for (let i = 0, length = data.length; i < length; i++) if (callback(data[i], i, data)) return true; return false; }
// Empty every is true and empty some is false without invoking either callback. Route: a static bigint array field and typed callbacks with both boolean answers. Node prints iteration-callback-empty-static:ok.
type Samples = bigint[];
class EmptySource { static data: Samples = localBigInt64Array([]); }
for (const answer of [true, false]) {
  const log: (number | bigint | boolean)[] = [];
  const callback = (value: bigint, index: number, owner: Samples): boolean => { log.push(value, index, owner === EmptySource.data); return answer; };
  assert.sameValue(localEvery(EmptySource.data, callback), true); assert.sameValue(localSome(EmptySource.data, callback), false);
  assert.compareArray(log, []);
}
console.log("iteration-callback-empty-static:ok");
