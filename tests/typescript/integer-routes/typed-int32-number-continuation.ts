/*---
description: Int32Array reads resume fractional, wide and signed-zero arithmetic after signed 32-bit wrapping.
features: [ts-integer-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-typeof-operator]
---*/
// Int32Array storage produces an integer; its number read then gains a half, crosses the element width, and can become -0.
const expectedInteger: number[] = [0, 0, 1, -1, 2147483647, -2147483648, -2147483648, -1, 0, -1, 0, 0, 0, 0, 0, 0, 32767, 32768, -32769, 65535, 65536, 255, 256, 257, -257, 1, 2, 3, 254, 255, -2];
const expectedFraction: number[] = [0.5, 0.5, 1.5, -0.5, 2147483647.5, -2147483647.5, -2147483647.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 32767.5, 32768.5, -32768.5, 65535.5, 65536.5, 255.5, 256.5, 257.5, -256.5, 1.5, 2.5, 3.5, 254.5, 255.5, -1.5];
const expectedWide: number[] = [1, 1, 3, -1, 4294967295, -4294967295, -4294967295, -1, 1, -1, 1, 1, 1, 1, 1, 1, 65535, 65537, -65537, 131071, 131073, 511, 513, 515, -513, 3, 5, 7, 509, 511, -3];
const expectedNegative: number[] = [-0, -0, -1, 1, -2147483647, 2147483648, 2147483648, 1, -0, 1, -0, -0, -0, -0, -0, -0, -32767, -32768, 32769, -65535, -65536, -255, -256, -257, 257, -1, -2, -3, -254, -255, 2];
for (const choice of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
  const input: number =
    choice === 0 ? 0 : choice === 1 ? -0 : choice === 2 ? 1 : choice === 3 ? -1 : choice === 4 ? 2147483647 :
    choice === 5 ? -2147483648 : choice === 6 ? 2147483648 : choice === 7 ? 4294967295 : choice === 8 ? 4294967296 : choice === 9 ? 9007199254740991 :
    choice === 10 ? 9007199254740992 : choice === 11 ? 0.5 : choice === 12 ? -0.5 : choice === 13 ? NaN : choice === 14 ? Infinity :
    choice === 15 ? -Infinity : choice === 16 ? 32767 : choice === 17 ? 32768 : choice === 18 ? -32769 : choice === 19 ? 65535 :
    choice === 20 ? 65536 : choice === 21 ? 255 : choice === 22 ? 256 : choice === 23 ? 257 : choice === 24 ? -257 :
    choice === 25 ? 1.5 : choice === 26 ? 2.5 : choice === 27 ? 3.5 : choice === 28 ? 254.5 : choice === 29 ? 255.5 : -2.9;
  const view: Int32Array = new Int32Array(1);
  view[0] = input;
  const integer: number = view[0];
  const fraction: number = integer + 0.5;
  const wide: number = fraction * 2;
  const negative: number = integer * -1;
  assert.sameValue(Object.is(integer, expectedInteger[choice]), true); assert.sameValue(typeof integer, "number");
  assert.sameValue(Object.is(fraction, expectedFraction[choice]), true); assert.sameValue(typeof fraction, "number");
  assert.sameValue(Object.is(wide, expectedWide[choice]), true); assert.sameValue(typeof wide, "number");
  assert.sameValue(Object.is(negative, expectedNegative[choice]), true); assert.sameValue(typeof negative, "number");
}
