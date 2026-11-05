/*---
description: "at normalizes interface-provided fractional offsets on empty, singleton and longer arrays."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class, ts-readonly, ts-unions, ts-null-undefined]
---*/

// at normalizes interface-provided fractional offsets on empty, singleton and longer arrays. Route: two implementations supplying a forward or negative index. Node prints reads-at-interface-indices:ok.
interface AtIndex { read(): number; }
class ForwardIndex implements AtIndex { read(): number { return 1.9; } }
class TailIndex implements AtIndex { read(): number { return -1.9; } }
const choices: readonly AtIndex[] = [new ForwardIndex(), new TailIndex()];
const arrays: readonly (readonly number[])[] = [[], [9], [1, 2, 3]];
const expected: readonly (readonly (number | undefined)[])[] = [[undefined, undefined], [undefined, 9], [2, 3]];
for (let i = 0; i < arrays.length; i++) for (let j = 0; j < choices.length; j++) {
  const found = arrays[i].at(choices[j].read());
  assert.sameValue(found, expected[i][j]);
}
console.log("reads-at-interface-indices:ok");
