/*---
description: Control for mixed-literal-union-update; A numeric literal union widens into a repeatedly updated number beyond its declared members.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-literal-types]
---*/
// Control: local number constants spell out the same successive arithmetic without the carrier.
const expected: number[][] = [
  [0, 1, 1.5],
  [-0, 1, 1.5],
  [1, 2, 2.5],
  [-1, 0, 0.5],
  [2147483647, 2147483648, 2147483648.5],
  [-2147483648, -2147483647, -2147483646.5],
  [2147483648, 2147483649, 2147483649.5],
  [4294967295, 4294967296, 4294967296.5],
  [4294967296, 4294967297, 4294967297.5],
  [9007199254740991, 9007199254740992, 9007199254740992],
  [9007199254740992, 9007199254740992, 9007199254740992],
  [0.5, 1.5, 2],
  [-0.5, 0.5, 1],
  [2147483646, 2147483647, 2147483647.5],
  [4294967294, 4294967295, 4294967295.5],
  [9007199254740990, 9007199254740991, 9007199254740992],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? 2147483646 : sample === 14 ? 4294967294 : 9007199254740990;
  const step0: number = input;
  assert.sameValue(Object.is(step0, expected[sample][0]), true); assert.sameValue(typeof step0, "number");
  const step1: number = step0 + 1;
  assert.sameValue(Object.is(step1, expected[sample][1]), true); assert.sameValue(typeof step1, "number");
  const step2: number = step1 + 0.5;
  assert.sameValue(Object.is(step2, expected[sample][2]), true); assert.sameValue(typeof step2, "number");
}
