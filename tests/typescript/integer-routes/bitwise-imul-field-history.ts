/*---
description: A rewritten number field preserves signed low-word multiplication, a wide half, and a second integer result.
features: [ts-integer-route-bitwise, ts-numbers, ts-expressions, ts-iteration, ts-class, ts-class-fields]
---*/
// Route: a number field starts at 1, takes an integer result, widens to a half above int32, then takes another integer result.
class IntegerWord { value: number = 1; }
const expected: [number, number, number][] = [
  [65537, 4295032833.5, 131073],
  [65537, 4295032833.5, 131073],
  [131074, 4295098370.5, 262146],
  [0, 4294967296.5, 0],
  [-2147483648, 2147483648.5, -2147483648],
  [-2147418111, 2147549185.5, -2147352575],
  [-2147418111, 2147549185.5, -2147352575],
  [0, 4294967296.5, 0],
  [65537, 4295032833.5, 131073],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [65537, 4295032833.5, 131073],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
  [0, 4294967296.5, 0],
];
for (let row = 0; row < 15; row++) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 :
    row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 :
    row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : Infinity;
  const word: IntegerWord = new IntegerWord();
  assert.sameValue(Object.is(word.value, 1), true); assert.sameValue(typeof word.value, "number");
  word.value = Math.imul((word.value + input), 65537);
  assert.sameValue(Object.is(word.value, expected[row][0]), true); assert.sameValue(typeof word.value, "number");
  word.value += 4294967296.5;
  assert.sameValue(Object.is(word.value, expected[row][1]), true); assert.sameValue(typeof word.value, "number");
  word.value = Math.imul(word.value, 65537);
  assert.sameValue(Object.is(word.value, expected[row][2]), true); assert.sameValue(typeof word.value, "number");
}
