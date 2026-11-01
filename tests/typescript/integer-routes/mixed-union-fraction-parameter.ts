/*---
description: An integer accumulator receives a fractional string step through a narrowed number-or-string parameter before cancellation.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-strings]
---*/
// A number accumulator adds numeric input, then string 0.5 through a union parameter; node retains fractional and rounded history.
function addMixedStep(total: number, part: number | string): number { return total + (typeof part === "number" ? part : Number(part)); }
const expected: number[][] = [
  [1, 1, 1.5, 1.5],
  [1, 1, 1.5, 1.5],
  [1, 2, 2.5, 1.5],
  [1, 0, 0.5, 1.5],
  [1, 2147483648, 2147483648.5, 1.5],
  [1, -2147483647, -2147483646.5, 1.5],
  [1, 2147483649, 2147483649.5, 1.5],
  [1, 4294967296, 4294967296.5, 1.5],
  [1, 4294967297, 4294967297.5, 1.5],
  [1, 9007199254740992, 9007199254740992, 1],
  [1, 9007199254740992, 9007199254740992, 0],
  [1, 1.5, 2, 1.5],
  [1, 0.5, 1, 1.5],
  [1, NaN, NaN, NaN],
  [1, Infinity, Infinity, NaN],
  [1, 2147483647, 2147483647.5, 1.5],
  [1, 4294967295, 4294967295.5, 1.5],
  [1, 9007199254740991, 9007199254740992, 2],
  [1, -Infinity, -Infinity, NaN],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? NaN : sample === 14 ? Infinity : sample === 15 ? 2147483646 :
    sample === 16 ? 4294967294 : sample === 17 ? 9007199254740990 : -Infinity;
  let total: number = 1;
  assert.sameValue(Object.is(total, expected[sample][0]), true); assert.sameValue(typeof total, "number");
  for (let phase = 0; phase < 3; phase++) {
    total = addMixedStep(total, phase === 0 ? input : phase === 1 ? "0.5" : -input);
    assert.sameValue(Object.is(total, expected[sample][phase + 1]), true); assert.sameValue(typeof total, "number");
  }
}
