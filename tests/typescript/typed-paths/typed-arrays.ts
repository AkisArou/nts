/*---
description: Typed arrays store each element in their own representation: Int32 wraps, Uint8 wraps, Uint8Clamped clamps, Float32 rounds.
features: [ts-arrays, ts-numbers]
---*/
const ints = new Int32Array(2);
ints[0] = 2 ** 31;
ints[1] = 3.9;
const bytes = new Uint8Array([256, -1, 300]);
const clamped = new Uint8ClampedArray([300, -5, 1.5, 2.5]);
const floats = new Float32Array([0.1]);
assert.compareArray([...ints], [-2147483648, 3]);
assert.compareArray([...bytes], [0, 255, 44]);
assert.compareArray([...clamped], [255, 0, 2, 2]);
assert.sameValue(floats[0], Math.fround(0.1));
assert.sameValue(floats[0] === 0.1, false);
