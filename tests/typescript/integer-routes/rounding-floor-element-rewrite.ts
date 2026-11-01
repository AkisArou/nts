/*---
description: An initially integral number array element is rewritten by floor, division and a boundary-crossing addition.
features: [ts-integer-route-rounding, ts-numbers, ts-iteration, ts-expressions, ts-arrays]
---*/
// Route: Math.floor updates one number[] element in successive phases, including negative halves, wide values, NaN and infinities.
const expected: number[][] = [
  [1, 0, 0, 2147483648], [1, -0, -0, 2147483648], [1, 1, 0.5, 2147483648.5], [1, -1, -0.5, 2147483647.5],
  [1, 2147483647, 1073741823.5, 3221225471.5], [1, -2147483648, -1073741824, 1073741824], [1, 2147483648, 1073741824, 3221225472], [1, 4294967295, 2147483647.5, 4294967295.5],
  [1, 4294967296, 2147483648, 4294967296], [1, 9007199254740991, 4503599627370495.5, 4503601774854144], [1, 9007199254740992, 4503599627370496, 4503601774854144], [1, 0, 0, 2147483648],
  [1, -1, -0.5, 2147483647.5], [1, NaN, NaN, NaN], [1, Infinity, Infinity, Infinity], [1, -Infinity, -Infinity, -Infinity],
  [1, -2, -1, 2147483647], [1, -3, -1.5, 2147483646.5], [1, 2147483647, 1073741823.5, 3221225471.5], [1, -2147483649, -1073741824.5, 1073741823.5],
  [1, -6, -3, 2147483645], [1, 6, 3, 2147483651], [1, -6, -3, 2147483645],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? -Infinity : row === 16 ? -1.5 : row === 17 ? -2.5 : row === 18 ? 2147483647.5 : row === 19 ? -2147483648.5 : row === 20 ? -6 : row === 21 ? 6 : -5.5;
  const cell: number[] = [1];
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) cell[0] = Math.floor(input);
    if (phase === 2) cell[0] = cell[0] / 2;
    if (phase === 3) cell[0] = cell[0] + 2147483648;
    assert.sameValue(Object.is(cell[0], expected[row][phase]), true);
    assert.sameValue(typeof cell[0], "number");
  }
}
