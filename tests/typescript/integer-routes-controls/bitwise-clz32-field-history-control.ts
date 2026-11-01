/*---
description: Control for bitwise-clz32-field-history; local number constants retain every stage.
features: [ts-integer-route-bitwise, ts-numbers, ts-expressions, ts-iteration]
---*/
// Control: local number constants spell out the same integer, wide half, and integer stages.
const expected: [number, number, number][] = [
  [31, 4294967327.5, 27],
  [31, 4294967327.5, 27],
  [30, 4294967326.5, 27],
  [32, 4294967328.5, 26],
  [0, 4294967296.5, 32],
  [0, 4294967296.5, 32],
  [0, 4294967296.5, 32],
  [32, 4294967328.5, 26],
  [31, 4294967327.5, 27],
  [32, 4294967328.5, 26],
  [32, 4294967328.5, 26],
  [31, 4294967327.5, 27],
  [32, 4294967328.5, 26],
  [32, 4294967328.5, 26],
  [32, 4294967328.5, 26],
];
for (let row = 0; row < 15; row++) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 :
    row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 :
    row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : Infinity;
  const initial: number = 1;
  assert.sameValue(Object.is(initial, 1), true); assert.sameValue(typeof initial, "number");
  const first: number = Math.clz32((initial + input));
  assert.sameValue(Object.is(first, expected[row][0]), true); assert.sameValue(typeof first, "number");
  const widened: number = first + 4294967296.5;
  assert.sameValue(Object.is(widened, expected[row][1]), true); assert.sameValue(typeof widened, "number");
  const last: number = Math.clz32(widened);
  assert.sameValue(Object.is(last, expected[row][2]), true); assert.sameValue(typeof last, "number");
}
