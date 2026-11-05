/*---
description: "ForEach passes the original receiver and sees a write ahead of the current callback in both implementations. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localUint8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localForEach(data: number[], callback: (value: number, index: number, owner: number[]) => void): void { for (let i = 0, length = data.length; i < length; i++) callback(data[i], i, data); }
// ForEach passes the original receiver and sees a write ahead of the current callback in both implementations. Route: an interface with signed-word and unsigned-byte array fields. Node prints iteration-callback-for-each-interface-live:ok.
type WholeSamples = number[];
type ByteSamples = number[];
type VisitLog = (number | boolean)[];
interface VisitSource { data: WholeSamples | ByteSamples; visit(replacement: number, log: VisitLog): void; }
class WholeSource implements VisitSource {
  data: WholeSamples = localInt16Array([-1, 2, 3]);
  visit(replacement: number, log: VisitLog): void {
    const callback = (value: number, index: number, owner: WholeSamples): void => { log.push(value, index, owner === this.data); if (index === 0) owner[2] = replacement; };
    return localForEach(this.data, callback);
  }
}
class ByteSource implements VisitSource {
  data: ByteSamples = localUint8Array([4, 5, 6]);
  visit(replacement: number, log: VisitLog): void {
    const callback = (value: number, index: number, owner: ByteSamples): void => { log.push(value, index, owner === this.data); if (index === 0) owner[2] = replacement; };
    return localForEach(this.data, callback);
  }
}
const rows: readonly [VisitSource, number, readonly number[], readonly (number | boolean)[]][] = [
  [new WholeSource(), -9, [-1, 2, -9], [-1, 0, true, 2, 1, true, -9, 2, true]],
  [new ByteSource(), 250, [4, 5, 250], [4, 0, true, 5, 1, true, 250, 2, true]],
  [new WholeSource(), 7, [-1, 2, 7], [-1, 0, true, 2, 1, true, 7, 2, true]]
];
for (const [source, replacement, expected, expectedLog] of rows) {
  const log: VisitLog = [], returned = source.visit(replacement, log), actual: number[] = []; assert.sameValue(returned, undefined);
  for (let i = 0; i < source.data.length; i++) actual[i] = source.data[i];
  assert.compareArray(actual, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-for-each-interface-live:ok");
