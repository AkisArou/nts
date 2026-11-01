/*---
description: A captured index changes from a small integer to a wide sum and a fractional quotient before array reads.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-arrays, ts-null-undefined, ts-functions]
---*/
// A declared closure reads a rewritten number index; node keeps the quotient and reads undefined when it is not an array index.
const expected: (number | undefined)[][] = [
  [1, 22, 1, 22, 0.5, undefined, 1, 22],
  [1, 22, 1, 22, 0.5, undefined, 1, 22],
  [1, 22, 2, 33, 1, 22, 1.5, undefined],
  [1, 22, 0, 11, 0, 11, 0.5, undefined],
  [1, 22, 2147483648, undefined, 1073741824, undefined, 1073741824.5, undefined],
  [1, 22, -2147483647, undefined, -1073741823.5, undefined, -1073741823, undefined],
  [1, 22, 2147483649, undefined, 1073741824.5, undefined, 1073741825, undefined],
  [1, 22, 4294967296, undefined, 2147483648, undefined, 2147483648.5, undefined],
  [1, 22, 4294967297, undefined, 2147483648.5, undefined, 2147483649, undefined],
  [1, 22, 9007199254740992, undefined, 4503599627370496, undefined, 4503599627370496, undefined],
  [1, 22, 9007199254740992, undefined, 4503599627370496, undefined, 4503599627370496, undefined],
  [1, 22, 1.5, undefined, 0.75, undefined, 1.25, undefined],
  [1, 22, 0.5, undefined, 0.25, undefined, 0.75, undefined],
  [1, 22, NaN, undefined, NaN, undefined, NaN, undefined],
  [1, 22, Infinity, undefined, Infinity, undefined, Infinity, undefined],
  [1, 22, 2147483647, undefined, 1073741823.5, undefined, 1073741824, undefined],
  [1, 22, 4294967295, undefined, 2147483647.5, undefined, 2147483648, undefined],
  [1, 22, 9007199254740991, undefined, 4503599627370495.5, undefined, 4503599627370496, undefined],
  [1, 22, -Infinity, undefined, -Infinity, undefined, -Infinity, undefined],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? NaN : sample === 14 ? Infinity : sample === 15 ? 2147483646 :
    sample === 16 ? 4294967294 : sample === 17 ? 9007199254740990 : -Infinity;
  let position: number = 1; const read: () => number = () => position;
  const items: number[] = [11, 22, 33];
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) position += input; else if (phase === 2) position /= 2; else if (phase === 3) position += 0.5;
    const index: number = read(); const actual: number | undefined = items[index];
    assert.sameValue(Object.is(index, expected[sample][phase * 2]), true); assert.sameValue(typeof index, "number");
    assert.sameValue(Object.is(actual, expected[sample][phase * 2 + 1]), true); assert.sameValue(typeof actual, typeof expected[sample][phase * 2 + 1]);
  }
}
