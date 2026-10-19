/*---
description: A bigint literal type admits its value, and typeof reports "bigint".
features: [ts-bigint, ts-literal-types, ts-unions]
---*/
type Bit = 0n | 1n;
function flip(bit: Bit): Bit {
  return bit === 0n ? 1n : 0n;
}
const bits: Bit[] = [0n, 1n, 1n];
assert.sameValue(bits.map(flip).join(""), "100");
assert.sameValue(typeof bits[0], "bigint");
const mixed: (number | bigint)[] = [1, 1n];
assert.sameValue(mixed.map((v) => typeof v).join(","), "number,bigint");
