/*---
description: Hexadecimal, binary, octal and exponent literals initialise members by their numeric value.
features: [ts-enum]
---*/
enum Mask { Hex = 0x10, Bin = 0b101, Oct = 0o17, Exp = 1e3 }
assert.sameValue(Mask.Hex, 16);
assert.sameValue(Mask.Bin, 5);
assert.sameValue(Mask.Oct, 15);
assert.sameValue(Mask.Exp, 1000);
assert.sameValue(Mask[1000], "Exp");
