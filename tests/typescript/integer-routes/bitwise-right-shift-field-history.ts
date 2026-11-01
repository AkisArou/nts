/*---
description: A rewritten number field preserves signed right shift with negative and oversized counts, a wide half, and a second integer result.
features: [ts-integer-route-bitwise, ts-numbers, ts-expressions, ts-iteration, ts-class, ts-class-fields]
---*/
// Route: a number field starts at 1, takes an integer result, widens to a half above int32, then takes another integer result.
class IntegerWord { value: number = 1; }
const expected: [number, number, number][] = [
  [0, 4294967296.5, 0],
  [1, 4294967297.5, 1],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [-1073741824, 3221225472.5, -536870912],
  [-1, 4294967295.5, -1],
  [-2147483647, 2147483649.5, -2147483647],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [1, 4294967297.5, 1],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [536870912, 4831838208.5, 268435456],
  [-1, 4294967295.5, -1],
  [-2147483648, 2147483648.5, -2147483648],
  [-1, 4294967295.5, -1],
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
  const word: IntegerWord = new IntegerWord();
  assert.sameValue(Object.is(word.value, 1), true); assert.sameValue(typeof word.value, "number");
  word.value = (word.value + input) >> count;
  assert.sameValue(Object.is(word.value, expected[row][0]), true); assert.sameValue(typeof word.value, "number");
  word.value += 4294967296.5;
  assert.sameValue(Object.is(word.value, expected[row][1]), true); assert.sameValue(typeof word.value, "number");
  word.value = word.value >> count;
  assert.sameValue(Object.is(word.value, expected[row][2]), true); assert.sameValue(typeof word.value, "number");
}
