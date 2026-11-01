/*---
description: A number index field gains wide or fractional values and must not alias a small array slot through int32 truncation.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-arrays, ts-null-undefined, ts-class, ts-class-fields]
---*/
// A field index starts at one, multiplies, increments and decrements; node reads undefined for wide and fractional indices.
class IntegerIndexField { value: number = 1; }
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
  const state = new IntegerIndexField();
  const items: number[] = [11, 22, 33];
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) state.value *= input; else if (phase === 2) ++state.value; else if (phase === 3) --state.value;
    const index: number = state.value; const actual: number | undefined = items[index];
    assert.sameValue(Object.is(index, expected[sample][phase * 2]), true); assert.sameValue(typeof index, "number");
    assert.sameValue(Object.is(actual, expected[sample][phase * 2 + 1]), true); assert.sameValue(typeof actual, typeof expected[sample][phase * 2 + 1]);
  }
}
