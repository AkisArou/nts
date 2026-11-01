/*---
description: Control for bitwise-xor-field-history; local number constants retain every stage.
features: [ts-integer-route-bitwise, ts-numbers, ts-expressions, ts-iteration]
---*/
// Control: local number constants spell out the same integer, wide half, and integer stages.
const expected: [number, number, number][] = [
  [1515870811, 5810838107.5, 1],
  [1515870811, 5810838107.5, 1],
  [1515870808, 5810838104.5, 2],
  [1515870810, 5810838106.5, 0],
  [-631612838, 3663354458.5, -2147483648],
  [-631612837, 3663354459.5, -2147483647],
  [-631612837, 3663354459.5, -2147483647],
  [1515870810, 5810838106.5, 0],
  [1515870811, 5810838107.5, 1],
  [1515870810, 5810838106.5, 0],
  [1515870810, 5810838106.5, 0],
  [1515870811, 5810838107.5, 1],
  [1515870810, 5810838106.5, 0],
  [1515870810, 5810838106.5, 0],
  [1515870810, 5810838106.5, 0],
];
for (let row = 0; row < 15; row++) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 :
    row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 :
    row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : Infinity;
  const initial: number = 1;
  assert.sameValue(Object.is(initial, 1), true); assert.sameValue(typeof initial, "number");
  const first: number = (initial + input) ^ 1515870810;
  assert.sameValue(Object.is(first, expected[row][0]), true); assert.sameValue(typeof first, "number");
  const widened: number = first + 4294967296.5;
  assert.sameValue(Object.is(widened, expected[row][1]), true); assert.sameValue(typeof widened, "number");
  const last: number = widened ^ 1515870810;
  assert.sameValue(Object.is(last, expected[row][2]), true); assert.sameValue(typeof last, "number");
}
