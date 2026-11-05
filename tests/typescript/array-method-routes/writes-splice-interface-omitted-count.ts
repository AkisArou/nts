/*---
description: "Splice with only a start removes to the end including negative starts on empty single and longer arrays through two interface implementations supplying splice operations."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-numbers]
---*/

// Splice with only a start removes to the end including negative starts on empty single and longer arrays; route: two interface implementations supplying splice operations.
// Node prints writes-splice-interface-omitted-count:ok.
interface Remover { remove(input: number[]): number[] }
class TailRemover implements Remover { remove(input: number[]): number[] { return input.splice(1); } }
class NegativeRemover implements Remover { remove(input: number[]): number[] { return input.splice(-2); } }
const tail: Remover = new TailRemover(), negative: Remover = new NegativeRemover();
const rows: readonly [Remover, number[], readonly number[], readonly number[]][] = [
  [tail, [], [], []], [tail, [9], [], [9]], [tail, [1, 2, 3, 4, 5], [2, 3, 4, 5], [1]],
  [negative, [], [], []], [negative, [9], [9], []], [negative, [1, 2, 3, 4, 5], [4, 5], [1, 2, 3]]
];
for (const [remover, input, removed, remaining] of rows) {
  const result = remover.remove(input);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-interface-omitted-count:ok");
