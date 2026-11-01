/*---
description: Control for mixed-union-fraction-parameter; An integer accumulator receives a fractional string step through a narrowed number-or-string parameter before cancellation.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-strings]
---*/
// Control: local number constants spell out the same successive arithmetic without the carrier.
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
  const step0: number = 1;
  assert.sameValue(Object.is(step0, expected[sample][0]), true); assert.sameValue(typeof step0, "number");
  const step1: number = step0 + input;
  assert.sameValue(Object.is(step1, expected[sample][1]), true); assert.sameValue(typeof step1, "number");
  const step2: number = step1 + 0.5;
  assert.sameValue(Object.is(step2, expected[sample][2]), true); assert.sameValue(typeof step2, "number");
  const step3: number = step2 + (-input);
  assert.sameValue(Object.is(step3, expected[sample][3]), true); assert.sameValue(typeof step3, "number");
}
