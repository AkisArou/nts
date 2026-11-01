/*---
description: A loop sum routed through number parameters and returns retains rounding when a large addend is cancelled before a fractional step.
features: [ts-integer-route-counters, ts-numbers, ts-iteration, ts-expressions, ts-functions]
---*/
// Route: A number return carries 1 + input, then that result + (-input), then +0.25; Node keeps cancellation rounding instead of assuming exact integer algebra.
function sumReturned(value: number, step: number): number { return value + step; }
const expected: number[][] = [
  [1, 1, 1, 1.25], [1, 1, 1, 1.25], [1, 2, 1, 1.25], [1, 0, 1, 1.25],
  [1, 2147483648, 1, 1.25], [1, -2147483647, 1, 1.25], [1, 2147483649, 1, 1.25], [1, 4294967296, 1, 1.25],
  [1, 4294967297, 1, 1.25], [1, 9007199254740992, 1, 1.25], [1, 9007199254740992, 0, 0.25], [1, 1.5, 1, 1.25],
  [1, 0.5, 1, 1.25], [1, NaN, NaN, NaN], [1, Infinity, NaN, NaN], [1, 2147483647, 1, 1.25],
  [1, 4294967295, 1, 1.25], [1, 9007199254740991, 1, 1.25], [1, -Infinity, NaN, NaN],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? 2147483646 : row === 16 ? 4294967294 : row === 17 ? 9007199254740990 : -Infinity;
  let current: number = 1;
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) current = sumReturned(current, input);
    if (phase === 2) current = sumReturned(current, -input);
    if (phase === 3) current = sumReturned(current, 0.25);
    assert.sameValue(Object.is(current, expected[row][phase]), true);
    assert.sameValue(typeof current, "number");
  }
}
