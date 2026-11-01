/*---
description: Numeric enum members enter a number field which increments and then halves beyond the enum members.
features: [ts-integer-route-mixed, ts-numbers, ts-iteration, ts-enum, ts-class, ts-class-fields]
---*/
// An enum seed replaces a small number field before increment and division; node keeps the exact nonmember values and zero sign.
enum IntegerChoice { Zero = 0, NegativeZero = -0, One = 1, MinusOne = -1, Int32Last = 2147483647, Int32First = -2147483648, Int32Next = 2147483648, Uint32Last = 4294967295, Uint32Next = 4294967296, SafeLast = 9007199254740991, SafeNext = 9007199254740992, Half = 0.5, NegativeHalf = -0.5, Int32Before = 2147483646, Uint32Before = 4294967294, SafeBefore = 9007199254740990 }
class EnumIntegerState { value: number = 1; }
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
  const input: IntegerChoice =
    sample === 0 ? IntegerChoice.Zero : sample === 1 ? IntegerChoice.NegativeZero : sample === 2 ? IntegerChoice.One : sample === 3 ? IntegerChoice.MinusOne :
    sample === 4 ? IntegerChoice.Int32Last : sample === 5 ? IntegerChoice.Int32First : sample === 6 ? IntegerChoice.Int32Next : sample === 7 ? IntegerChoice.Uint32Last :
    sample === 8 ? IntegerChoice.Uint32Next : sample === 9 ? IntegerChoice.SafeLast : sample === 10 ? IntegerChoice.SafeNext : sample === 11 ? IntegerChoice.Half :
    sample === 12 ? IntegerChoice.NegativeHalf : sample === 13 ? IntegerChoice.Int32Before : sample === 14 ? IntegerChoice.Uint32Before : IntegerChoice.SafeBefore;
  const state = new EnumIntegerState();
  assert.sameValue(Object.is(state.value, expected[sample][0]), true); assert.sameValue(typeof state.value, "number");
  for (let phase = 0; phase < 3; phase++) {
    if (phase === 0) state.value = input; else if (phase === 1) ++state.value; else state.value /= 2;
    assert.sameValue(Object.is(state.value, expected[sample][phase + 1]), true); assert.sameValue(typeof state.value, "number");
  }
}
