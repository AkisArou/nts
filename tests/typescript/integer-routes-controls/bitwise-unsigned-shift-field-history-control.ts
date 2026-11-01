/*---
description: Control for bitwise-unsigned-shift-field-history; local number constants retain every stage.
features: [ts-integer-route-bitwise, ts-numbers, ts-expressions, ts-iteration]
---*/
// Control: local number constants spell out the same integer, wide half, and integer stages.
const expected: [number, number, number][] = [
  [0, 4294967296.5, 0],
  [1, 4294967297.5, 1],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [1073741824, 5368709120.5, 536870912],
  [1, 4294967297.5, 0],
  [2147483649, 6442450945.5, 2147483649],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [1, 4294967297.5, 1],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [536870912, 4831838208.5, 268435456],
  [1, 4294967297.5, 0],
  [2147483648, 6442450944.5, 2147483648],
  [2147483647, 6442450943.5, 1073741823],
  [4, 4294967300.5, 4],
  [0, 4294967296.5, 0],
];
for (let row = 0; row < 21; row++) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 :
    row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 :
    row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity :
    row === 15 ? 1073741823 : row === 16 ? -2147483647 : row === 17 ? 2147483647 : row === 18 ? -3 : row === 19 ? 3 :
    3;
  const count: number = row === 0 ? -33 : row === 1 ? -32 : row === 2 ? -1 : row === 3 ? 0 : row === 4 ? 1 :
    row === 5 ? 31 : row === 6 ? 32 : row === 7 ? 33 : row === 8 ? 63 : row === 9 ? 64 :
    row === 10 ? 65 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity :
    row === 15 ? 1 : row === 16 ? -1 : row === 17 ? 0 : row === 18 ? 33 : row === 19 ? 32 :
    -33;
  const initial: number = 1;
  assert.sameValue(Object.is(initial, 1), true); assert.sameValue(typeof initial, "number");
  const first: number = (initial + input) >>> count;
  assert.sameValue(Object.is(first, expected[row][0]), true); assert.sameValue(typeof first, "number");
  const widened: number = first + 4294967296.5;
  assert.sameValue(Object.is(widened, expected[row][1]), true); assert.sameValue(typeof widened, "number");
  const last: number = widened >>> count;
  assert.sameValue(Object.is(last, expected[row][2]), true); assert.sameValue(typeof last, "number");
}
