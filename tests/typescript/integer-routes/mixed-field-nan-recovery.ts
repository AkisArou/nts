/*---
description: A number field changes from an integer sum to NaN and then receives a new finite or nonfinite sum.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-class, ts-class-fields]
---*/
// The number field first sums, then gains NaN, then is overwritten; node exposes every change, including recovery from NaN.
class MixedIntegerField { value: number = 1; }
const expected: number[][] = [
  [1, 1, NaN, 3, 3],
  [1, 1, NaN, 3, 3],
  [1, 2, NaN, 4, 3],
  [1, 0, NaN, 2, 3],
  [1, 2147483648, NaN, 2147483650, 3],
  [1, -2147483647, NaN, -2147483645, 3],
  [1, 2147483649, NaN, 2147483651, 3],
  [1, 4294967296, NaN, 4294967298, 3],
  [1, 4294967297, NaN, 4294967299, 3],
  [1, 9007199254740992, NaN, 9007199254740994, 3],
  [1, 9007199254740992, NaN, 9007199254740996, 4],
  [1, 1.5, NaN, 3.5, 3],
  [1, 0.5, NaN, 2.5, 3],
  [1, NaN, NaN, NaN, NaN],
  [1, Infinity, NaN, Infinity, NaN],
  [1, 2147483647, NaN, 2147483649, 3],
  [1, 4294967295, NaN, 4294967297, 3],
  [1, 9007199254740991, NaN, 9007199254740992, 2],
  [1, -Infinity, NaN, -Infinity, NaN],
];
for (const sample of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const input: number =
    sample === 0 ? 0 : sample === 1 ? -0 : sample === 2 ? 1 : sample === 3 ? -1 :
    sample === 4 ? 2147483647 : sample === 5 ? -2147483648 : sample === 6 ? 2147483648 : sample === 7 ? 4294967295 :
    sample === 8 ? 4294967296 : sample === 9 ? 9007199254740991 : sample === 10 ? 9007199254740992 : sample === 11 ? 0.5 :
    sample === 12 ? -0.5 : sample === 13 ? NaN : sample === 14 ? Infinity : sample === 15 ? 2147483646 :
    sample === 16 ? 4294967294 : sample === 17 ? 9007199254740990 : -Infinity;
  const state = new MixedIntegerField();
  assert.sameValue(Object.is(state.value, expected[sample][0]), true); assert.sameValue(typeof state.value, "number");
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 0) state.value += input; else if (phase === 1) state.value += NaN;
    else if (phase === 2) state.value = 3 + input; else state.value += -input;
    assert.sameValue(Object.is(state.value, expected[sample][phase + 1]), true); assert.sameValue(typeof state.value, "number");
  }
}
