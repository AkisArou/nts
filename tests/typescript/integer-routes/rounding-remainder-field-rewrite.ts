/*---
description: A small number field retains dividend-signed and fractional remainders, including NaN after a zero divisor.
features: [ts-integer-route-rounding, ts-numbers, ts-iteration, ts-expressions, ts-class, ts-class-fields]
---*/
// Route: Compound remainder rewrites one number field, followed by /2; negative operands, signed-zero divisors and exact negative multiples exercise -0 and NaN.
class RoundingCell { value: number = 1; }
const expected: number[][] = [
  [1, 0, 0, 0], [1, -0, -0, -0], [1, 1, NaN, NaN], [1, -1, NaN, NaN],
  [1, 2147483647, 1, 0.5], [1, -2147483648, -0, -0], [1, 2147483648, NaN, NaN], [1, 4294967295, NaN, NaN],
  [1, 4294967296, 0, 0], [1, 9007199254740991, 1, 0.5], [1, 9007199254740992, NaN, NaN], [1, 0.5, NaN, NaN],
  [1, -0.5, -0.5, -0.25], [1, NaN, NaN, NaN], [1, Infinity, NaN, NaN], [1, -Infinity, NaN, NaN],
  [1, -1.5, -1.5, -0.75], [1, -2.5, -0.5, -0.25], [1, 2147483647.5, NaN, NaN], [1, -2147483648.5, NaN, NaN],
  [1, -6, -0, -0], [1, 6, 0, 0], [1, -5.5, NaN, NaN],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? -Infinity : row === 16 ? -1.5 : row === 17 ? -2.5 : row === 18 ? 2147483647.5 : row === 19 ? -2147483648.5 : row === 20 ? -6 : row === 21 ? 6 : -5.5;
  const divisor: number = row % 4 === 0 ? 2 : row % 4 === 1 ? -2 : row % 4 === 2 ? 0 : -0;
  const cell = new RoundingCell();
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) cell.value = input;
    if (phase === 2) cell.value = cell.value % divisor;
    if (phase === 3) cell.value = cell.value / 2;
    assert.sameValue(Object.is(cell.value, expected[row][phase]), true);
    assert.sameValue(typeof cell.value, "number");
  }
}
