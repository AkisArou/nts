/*---
description: Integer division via Math.trunc rewrites a small number field while preserving wide quotients, negative zero and NaN.
features: [ts-integer-route-rounding, ts-numbers, ts-iteration, ts-expressions, ts-class, ts-class-fields]
---*/
// Route: Math.trunc(a / b) retains a double-valued integer unlike |0; subsequent /2 and +2^31 reads the rewritten field at each phase.
class RoundingCell { value: number = 1; }
const expected: number[][] = [
  [1, 0, 0, 2147483648], [1, 0, 0, 2147483648], [1, 0, 0, 2147483648], [1, 2, 1, 2147483649],
  [1, 1073741823, 536870911.5, 2684354559.5], [1, 4294967296, 2147483648, 4294967296], [1, 1073741824, 536870912, 2684354560], [1, -8589934590, -4294967295, -2147483647],
  [1, 2147483648, 1073741824, 3221225472], [1, -18014398509481982, -9007199254740991, -9007197107257343], [1, 4503599627370496, 2251799813685248, 2251801961168896], [1, -1, -0.5, 2147483647.5],
  [1, -0, -0, 2147483648], [1, NaN, NaN, NaN], [1, Infinity, Infinity, Infinity], [1, Infinity, Infinity, Infinity],
  [1, -0, -0, 2147483648], [1, 5, 2.5, 2147483650.5], [1, 1073741823, 536870911.5, 2684354559.5], [1, 4294967297, 2147483648.5, 4294967296.5],
  [1, -3, -1.5, 2147483646.5], [1, -12, -6, 2147483642], [1, -2, -1, 2147483647],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? -Infinity : row === 16 ? -1.5 : row === 17 ? -2.5 : row === 18 ? 2147483647.5 : row === 19 ? -2147483648.5 : row === 20 ? -6 : row === 21 ? 6 : -5.5;
  const divisor: number = row % 2 === 0 ? 2 : -0.5;
  const cell = new RoundingCell();
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) cell.value = Math.trunc(input / divisor);
    if (phase === 2) cell.value = cell.value / 2;
    if (phase === 3) cell.value = cell.value + 2147483648;
    assert.sameValue(Object.is(cell.value, expected[row][phase]), true);
    assert.sameValue(typeof cell.value, "number");
  }
}
