/*---
description: Control for mixed-index-field-width; A number index field gains wide or fractional values and must not alias a small array slot through int32 truncation.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-arrays, ts-null-undefined, ts-class, ts-class-fields]
---*/
// Control: local number constants form each index; direct scalar slot selection gives the same read without an index carrier.
const expected: (number | undefined)[][] = [
  [1, 22, 0, 11, 1, 22, 0, 11],
  [1, 22, -0, 11, 1, 22, 0, 11],
  [1, 22, 1, 22, 2, 33, 1, 22],
  [1, 22, -1, undefined, 0, 11, -1, undefined],
  [1, 22, 2147483647, undefined, 2147483648, undefined, 2147483647, undefined],
  [1, 22, -2147483648, undefined, -2147483647, undefined, -2147483648, undefined],
  [1, 22, 2147483648, undefined, 2147483649, undefined, 2147483648, undefined],
  [1, 22, 4294967295, undefined, 4294967296, undefined, 4294967295, undefined],
  [1, 22, 4294967296, undefined, 4294967297, undefined, 4294967296, undefined],
  [1, 22, 9007199254740991, undefined, 9007199254740992, undefined, 9007199254740991, undefined],
  [1, 22, 9007199254740992, undefined, 9007199254740992, undefined, 9007199254740991, undefined],
  [1, 22, 0.5, undefined, 1.5, undefined, 0.5, undefined],
  [1, 22, -0.5, undefined, 0.5, undefined, -0.5, undefined],
  [1, 22, NaN, undefined, NaN, undefined, NaN, undefined],
  [1, 22, Infinity, undefined, Infinity, undefined, Infinity, undefined],
  [1, 22, 2147483646, undefined, 2147483647, undefined, 2147483646, undefined],
  [1, 22, 4294967294, undefined, 4294967295, undefined, 4294967294, undefined],
  [1, 22, 9007199254740990, undefined, 9007199254740991, undefined, 9007199254740990, undefined],
  [1, 22, -Infinity, undefined, -Infinity, undefined, -Infinity, undefined],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? NaN : sample === 14 ? Infinity : sample === 15 ? 2147483646 :
    sample === 16 ? 4294967294 : sample === 17 ? 9007199254740990 : -Infinity;
  const step0: number = 1; const read0: number | undefined = step0 === 0 ? 11 : step0 === 1 ? 22 : step0 === 2 ? 33 : undefined;
  assert.sameValue(Object.is(step0, expected[sample][0]), true); assert.sameValue(typeof step0, "number");
  assert.sameValue(Object.is(read0, expected[sample][1]), true); assert.sameValue(typeof read0, typeof expected[sample][1]);
  const step1: number = step0 * input; const read1: number | undefined = step1 === 0 ? 11 : step1 === 1 ? 22 : step1 === 2 ? 33 : undefined;
  assert.sameValue(Object.is(step1, expected[sample][2]), true); assert.sameValue(typeof step1, "number");
  assert.sameValue(Object.is(read1, expected[sample][3]), true); assert.sameValue(typeof read1, typeof expected[sample][3]);
  const step2: number = step1 + 1; const read2: number | undefined = step2 === 0 ? 11 : step2 === 1 ? 22 : step2 === 2 ? 33 : undefined;
  assert.sameValue(Object.is(step2, expected[sample][4]), true); assert.sameValue(typeof step2, "number");
  assert.sameValue(Object.is(read2, expected[sample][5]), true); assert.sameValue(typeof read2, typeof expected[sample][5]);
  const step3: number = step2 - 1; const read3: number | undefined = step3 === 0 ? 11 : step3 === 1 ? 22 : step3 === 2 ? 33 : undefined;
  assert.sameValue(Object.is(step3, expected[sample][6]), true); assert.sameValue(typeof step3, "number");
  assert.sameValue(Object.is(read3, expected[sample][7]), true); assert.sameValue(typeof read3, typeof expected[sample][7]);
}
