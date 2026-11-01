/*---
description: Each retained for-of array binding sees later element mutations without sharing another iteration array.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Route: typed per-iteration array bindings are captured before pushes and later mutations; node preserves each identity and updated elements.
const inputs: number[] = [0, -0, NaN, 0.5, -1.25, 2147483648, 4294967296, Infinity];
function checkLoop(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
for (const input of inputs) {
  const first: number[] = [1]; const second: number[] = [2]; const source: number[][] = [first, second];
  const log: string[] = []; const retained: number[][] = []; const readers: ((phase: string) => number[])[] = [];
  let turn = 0;
  for (let value of source) {
    log.push("write:iteration:" + turn);
    const read: (phase: string) => number[] = phase => { log.push("read:" + phase); return value; }; readers.push(read);
    const before = read("before:" + turn); assert.sameValue(Object.is(before, source[turn]), true); assert.sameValue(typeof before, "object");
    value.push(input); log.push("write:push:" + turn);
    const after = read("after:" + turn); assert.sameValue(Object.is(after, source[turn]), true); assert.sameValue(typeof after, "object");
    checkLoop(after[1], input); retained.push(value); log.push("retain:" + turn); turn++;
  }
  first[0] = input; log.push("write:first:0"); second.push(input); log.push("write:second:2");
  const expected: number[][] = [[input, input], [2, input, input]];
  for (let at = 0; at < 2; at++) {
    const actual = readers[at]("late:" + at); assert.sameValue(Object.is(actual, source[at]), true); assert.sameValue(typeof actual, "object");
    assert.compareArray(actual, expected[at]); assert.sameValue(actual.length, expected[at].length);
    for (let index = 0; index < actual.length; index++) checkLoop(actual[index], expected[at][index]);
  }
  assert.sameValue(Object.is(retained[0], first), true); assert.sameValue(Object.is(retained[1], second), true);
  assert.compareArray(first, [input, input]); assert.compareArray(second, [2, input, input]); assert.sameValue(turn, 2);
  assert.compareArray(log, ["write:iteration:0", "read:before:0", "write:push:0", "read:after:0", "retain:0", "write:iteration:1", "read:before:1", "write:push:1", "read:after:1", "retain:1", "write:first:0", "write:second:2", "read:late:0", "read:late:1"]);
}
