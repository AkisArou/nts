/*---
description: Control for mixed-enum-field-rewrite; Numeric enum members enter a number field which increments and then halves beyond the enum members.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-enum, ts-class, ts-class-fields]
---*/
// Control: local number constants spell out the same successive arithmetic without the carrier.
const expected: number[][] = [
  [1, 0, 1, 0.5],
  [1, -0, 1, 0.5],
  [1, 1, 2, 1],
  [1, -1, 0, 0],
  [1, 2147483647, 2147483648, 1073741824],
  [1, -2147483648, -2147483647, -1073741823.5],
  [1, 2147483648, 2147483649, 1073741824.5],
  [1, 4294967295, 4294967296, 2147483648],
  [1, 4294967296, 4294967297, 2147483648.5],
  [1, 9007199254740991, 9007199254740992, 4503599627370496],
  [1, 9007199254740992, 9007199254740992, 4503599627370496],
  [1, 0.5, 1.5, 0.75],
  [1, -0.5, 0.5, 0.25],
  [1, 2147483646, 2147483647, 1073741823.5],
  [1, 4294967294, 4294967295, 2147483647.5],
  [1, 9007199254740990, 9007199254740991, 4503599627370495.5],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? 2147483646 : sample === 14 ? 4294967294 : 9007199254740990;
  const step0: number = 1;
  assert.sameValue(Object.is(step0, expected[sample][0]), true); assert.sameValue(typeof step0, "number");
  const step1: number = input;
  assert.sameValue(Object.is(step1, expected[sample][1]), true); assert.sameValue(typeof step1, "number");
  const step2: number = step1 + 1;
  assert.sameValue(Object.is(step2, expected[sample][2]), true); assert.sameValue(typeof step2, "number");
  const step3: number = step2 / 2;
  assert.sameValue(Object.is(step3, expected[sample][3]), true); assert.sameValue(typeof step3, "number");
}
