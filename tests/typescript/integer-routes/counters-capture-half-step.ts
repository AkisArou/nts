/*---
description: A captured loop counter leaves the integers through half steps and retains node rounding near the safe-integer limit.
features: [ts-integer-route-counters, ts-numbers, ts-iteration, ts-expressions, ts-closures, ts-arrow-functions, ts-function-types]
---*/
// Route: A captured number starts at 0, adds the input and then 0.5 twice; Node preserves fractional intermediate reads and rounds each addition separately.
const expected: number[][] = [
  [0, 0, 0.5, 1], [0, 0, 0.5, 1], [0, 1, 1.5, 2], [0, -1, -0.5, 0],
  [0, 2147483647, 2147483647.5, 2147483648], [0, -2147483648, -2147483647.5, -2147483647], [0, 2147483648, 2147483648.5, 2147483649], [0, 4294967295, 4294967295.5, 4294967296],
  [0, 4294967296, 4294967296.5, 4294967297], [0, 9007199254740991, 9007199254740992, 9007199254740992], [0, 9007199254740992, 9007199254740992, 9007199254740992], [0, 0.5, 1, 1.5],
  [0, -0.5, 0, 0.5], [0, NaN, NaN, NaN], [0, Infinity, Infinity, Infinity], [0, 2147483646, 2147483646.5, 2147483647],
  [0, 4294967294, 4294967294.5, 4294967295], [0, 9007199254740990, 9007199254740990, 9007199254740990], [0, -Infinity, -Infinity, -Infinity],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? 2147483646 : row === 16 ? 4294967294 : row === 17 ? 9007199254740990 : -Infinity;
  let current: number = 0;
  const readCurrent: () => number = () => current;
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) current += input;
    if (phase === 2) current += 0.5;
    if (phase === 3) current += 0.5;
    assert.sameValue(Object.is(readCurrent(), expected[row][phase]), true);
    assert.sameValue(typeof readCurrent(), "number");
  }
}
