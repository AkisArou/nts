/*---
description: Control for typed-uint32-number-continuation; scalar unsigned 32-bit wrapping followed by the same number operations.
features: [ts-integer-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-typeof-operator]
---*/
// Direct local number constants model element conversion; later arithmetic has no typed-array carrier.
const expectedInteger: number[] = [0, 0, 1, 4294967295, 2147483647, 2147483648, 2147483648, 4294967295, 0, 4294967295, 0, 0, 0, 0, 0, 0, 32767, 32768, 4294934527, 65535, 65536, 255, 256, 257, 4294967039, 1, 2, 3, 254, 255, 4294967294];
const expectedFraction: number[] = [0.5, 0.5, 1.5, 4294967295.5, 2147483647.5, 2147483648.5, 2147483648.5, 4294967295.5, 0.5, 4294967295.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 32767.5, 32768.5, 4294934527.5, 65535.5, 65536.5, 255.5, 256.5, 257.5, 4294967039.5, 1.5, 2.5, 3.5, 254.5, 255.5, 4294967294.5];
const expectedWide: number[] = [1, 1, 3, 8589934591, 4294967295, 4294967297, 4294967297, 8589934591, 1, 8589934591, 1, 1, 1, 1, 1, 1, 65535, 65537, 8589869055, 131071, 131073, 511, 513, 515, 8589934079, 3, 5, 7, 509, 511, 8589934589];
const expectedNegative: number[] = [-0, -0, -1, -4294967295, -2147483647, -2147483648, -2147483648, -4294967295, -0, -4294967295, -0, -0, -0, -0, -0, -0, -32767, -32768, -4294934527, -65535, -65536, -255, -256, -257, -4294967039, -1, -2, -3, -254, -255, -4294967294];
for (const choice of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
  const input: number =
    choice === 0 ? 0 : choice === 1 ? -0 : choice === 2 ? 1 : choice === 3 ? -1 : choice === 4 ? 2147483647 :
    choice === 5 ? -2147483648 : choice === 6 ? 2147483648 : choice === 7 ? 4294967295 : choice === 8 ? 4294967296 : choice === 9 ? 9007199254740991 :
    choice === 10 ? 9007199254740992 : choice === 11 ? 0.5 : choice === 12 ? -0.5 : choice === 13 ? NaN : choice === 14 ? Infinity :
    choice === 15 ? -Infinity : choice === 16 ? 32767 : choice === 17 ? 32768 : choice === 18 ? -32769 : choice === 19 ? 65535 :
    choice === 20 ? 65536 : choice === 21 ? 255 : choice === 22 ? 256 : choice === 23 ? 257 : choice === 24 ? -257 :
    choice === 25 ? 1.5 : choice === 26 ? 2.5 : choice === 27 ? 3.5 : choice === 28 ? 254.5 : choice === 29 ? 255.5 : -2.9;
  const truncated: number = Number.isFinite(input) ? Math.trunc(input) : 0;
  const residue: number = ((truncated % 4294967296) + 4294967296) % 4294967296;
  const integer: number = residue;
  const fraction: number = integer + 0.5;
  const wide: number = fraction * 2;
  const negative: number = integer * -1;
  assert.sameValue(Object.is(integer, expectedInteger[choice]), true); assert.sameValue(typeof integer, "number");
  assert.sameValue(Object.is(fraction, expectedFraction[choice]), true); assert.sameValue(typeof fraction, "number");
  assert.sameValue(Object.is(wide, expectedWide[choice]), true); assert.sameValue(typeof wide, "number");
  assert.sameValue(Object.is(negative, expectedNegative[choice]), true); assert.sameValue(typeof negative, "number");
}
