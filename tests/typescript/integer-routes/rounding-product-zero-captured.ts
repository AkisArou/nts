/*---
description: A captured number rewritten by a negative-zero product preserves its zero sign when a later reciprocal reads it.
features: [ts-integer-route-rounding, ts-numbers, ts-iteration, ts-expressions, ts-closures, ts-arrow-functions, ts-function-types]
---*/
// Route: A capture starts at 1, receives each input, then is multiplied by -0; the later 1/value observes signed zero or NaN after infinite inputs.
const expected: number[][] = [
  [1, 0, -0, -Infinity], [1, -0, 0, Infinity], [1, 1, -0, -Infinity], [1, -1, 0, Infinity],
  [1, 2147483647, -0, -Infinity], [1, -2147483648, 0, Infinity], [1, 2147483648, -0, -Infinity], [1, 4294967295, -0, -Infinity],
  [1, 4294967296, -0, -Infinity], [1, 9007199254740991, -0, -Infinity], [1, 9007199254740992, -0, -Infinity], [1, 0.5, -0, -Infinity],
  [1, -0.5, 0, Infinity], [1, NaN, NaN, NaN], [1, Infinity, NaN, NaN], [1, -Infinity, NaN, NaN],
  [1, -1.5, 0, Infinity], [1, -2.5, 0, Infinity], [1, 2147483647.5, -0, -Infinity], [1, -2147483648.5, 0, Infinity],
  [1, -6, 0, Infinity], [1, 6, -0, -Infinity], [1, -5.5, 0, Infinity],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? -Infinity : row === 16 ? -1.5 : row === 17 ? -2.5 : row === 18 ? 2147483647.5 : row === 19 ? -2147483648.5 : row === 20 ? -6 : row === 21 ? 6 : -5.5;
  let current: number = 1;
  const readCurrent: () => number = () => current;
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) current = input;
    if (phase === 2) current = readCurrent() * -0;
    if (phase === 3) current = 1 / readCurrent();
    assert.sameValue(Object.is(readCurrent(), expected[row][phase]), true);
    assert.sameValue(typeof readCurrent(), "number");
  }
}
