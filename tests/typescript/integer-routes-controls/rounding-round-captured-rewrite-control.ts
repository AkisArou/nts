/*---
description: Control for A captured number starts at one and retains rounded values, negative zero and later fractional and wide writes.
features: [ts-integer-route-rounding, ts-numbers, ts-iteration, ts-expressions]
---*/
// Control: direct local number constants reproduce the same stages without the carrier.
const expected: number[][] = [
  [1, 0, 0, 2147483648], [1, -0, -0, 2147483648], [1, 1, 0.5, 2147483648.5], [1, -1, -0.5, 2147483647.5],
  [1, 2147483647, 1073741823.5, 3221225471.5], [1, -2147483648, -1073741824, 1073741824], [1, 2147483648, 1073741824, 3221225472], [1, 4294967295, 2147483647.5, 4294967295.5],
  [1, 4294967296, 2147483648, 4294967296], [1, 9007199254740991, 4503599627370495.5, 4503601774854144], [1, 9007199254740992, 4503599627370496, 4503601774854144], [1, 1, 0.5, 2147483648.5],
  [1, -0, -0, 2147483648], [1, NaN, NaN, NaN], [1, Infinity, Infinity, Infinity], [1, -Infinity, -Infinity, -Infinity],
  [1, -1, -0.5, 2147483647.5], [1, -2, -1, 2147483647], [1, 2147483648, 1073741824, 3221225472], [1, -2147483648, -1073741824, 1073741824],
  [1, -6, -3, 2147483645], [1, 6, 3, 2147483651], [1, -5, -2.5, 2147483645.5],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? -Infinity : row === 16 ? -1.5 : row === 17 ? -2.5 : row === 18 ? 2147483647.5 : row === 19 ? -2147483648.5 : row === 20 ? -6 : row === 21 ? 6 : -5.5;
  const stage0: number = 1;
  assert.sameValue(Object.is(stage0, expected[row][0]), true); assert.sameValue(typeof stage0, "number");
  const stage1: number = Math.round(input);
  assert.sameValue(Object.is(stage1, expected[row][1]), true); assert.sameValue(typeof stage1, "number");
  const stage2: number = stage1 / 2;
  assert.sameValue(Object.is(stage2, expected[row][2]), true); assert.sameValue(typeof stage2, "number");
  const stage3: number = stage2 + 2147483648;
  assert.sameValue(Object.is(stage3, expected[row][3]), true); assert.sameValue(typeof stage3, "number");
}
