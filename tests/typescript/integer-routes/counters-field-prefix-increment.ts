/*---
description: A number field incremented in a loop crosses signed, unsigned and safe-integer boundaries without wrapping.
features: [ts-integer-route-counters, ts-numbers, ts-iteration, ts-expressions, ts-class, ts-class-fields]
---*/
// Route: A field starts at 0, adds the input, then receives two prefix increments; Node preserves fractional and wide stages and rounds at 2^53.
class CounterCell { value: number = 0; }
const expected: number[][] = [
  [0, 0, 1, 2], [0, 0, 1, 2], [0, 1, 2, 3], [0, -1, 0, 1],
  [0, 2147483647, 2147483648, 2147483649], [0, -2147483648, -2147483647, -2147483646], [0, 2147483648, 2147483649, 2147483650], [0, 4294967295, 4294967296, 4294967297],
  [0, 4294967296, 4294967297, 4294967298], [0, 9007199254740991, 9007199254740992, 9007199254740992], [0, 9007199254740992, 9007199254740992, 9007199254740992], [0, 0.5, 1.5, 2.5],
  [0, -0.5, 0.5, 1.5], [0, NaN, NaN, NaN], [0, Infinity, Infinity, Infinity], [0, 2147483646, 2147483647, 2147483648],
  [0, 4294967294, 4294967295, 4294967296], [0, 9007199254740990, 9007199254740991, 9007199254740992], [0, -Infinity, -Infinity, -Infinity],
];
for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number = row === 0 ? 0 : row === 1 ? -0 : row === 2 ? 1 : row === 3 ? -1 : row === 4 ? 2147483647 : row === 5 ? -2147483648 : row === 6 ? 2147483648 : row === 7 ? 4294967295 : row === 8 ? 4294967296 : row === 9 ? 9007199254740991 : row === 10 ? 9007199254740992 : row === 11 ? 0.5 : row === 12 ? -0.5 : row === 13 ? NaN : row === 14 ? Infinity : row === 15 ? 2147483646 : row === 16 ? 4294967294 : row === 17 ? 9007199254740990 : -Infinity;
  const cell = new CounterCell();
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) cell.value += input;
    if (phase === 2) ++cell.value;
    if (phase === 3) ++cell.value;
    assert.sameValue(Object.is(cell.value, expected[row][phase]), true);
    assert.sameValue(typeof cell.value, "number");
  }
}
