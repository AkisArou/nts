/*---
description: "Every stops at the first false callback and otherwise visits the whole receiver with its exact arguments. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localEvery(data: number[], callback: (value: number, index: number, owner: number[]) => boolean): boolean { for (let i = 0, length = data.length; i < length; i++) if (!callback(data[i], i, data)) return false; return true; }
// Every stops at the first false callback and otherwise visits the whole receiver with its exact arguments. Route: an interface with integer and floating implementations. Node prints iteration-callback-every-interface:ok.
type WholeSamples = number[];
type RealSamples = number[];
type VisitLog = (number | boolean)[];
interface EverySource { check(limit: number, log: VisitLog): boolean; }
class WholeSource implements EverySource {
  data: WholeSamples = localInt16Array([1, 2, 3, 4]);
  check(limit: number, log: VisitLog): boolean {
    const callback = (value: number, index: number, owner: WholeSamples): boolean => { log.push(value, index, owner === this.data); return value < limit; };
    return localEvery(this.data, callback);
  }
}
class RealSource implements EverySource {
  data: RealSamples = localFloat64Array([-0, 1.5, 4.5]);
  check(limit: number, log: VisitLog): boolean {
    const callback = (value: number, index: number, owner: RealSamples): boolean => { log.push(value, index, owner === this.data); return value < limit; };
    return localEvery(this.data, callback);
  }
}
const rows: readonly [EverySource, number, boolean, readonly (number | boolean)[]][] = [
  [new WholeSource(), 2, false, [1, 0, true, 2, 1, true]],
  [new WholeSource(), 5, true, [1, 0, true, 2, 1, true, 3, 2, true, 4, 3, true]],
  [new RealSource(), 2, false, [-0, 0, true, 1.5, 1, true, 4.5, 2, true]],
  [new RealSource(), 0, false, [-0, 0, true]], [new RealSource(), 5, true, [-0, 0, true, 1.5, 1, true, 4.5, 2, true]]
];
for (const [source, limit, expected, expectedLog] of rows) {
  const log: VisitLog = []; assert.sameValue(source.check(limit, log), expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-every-interface:ok");
