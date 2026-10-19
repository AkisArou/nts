/*---
description: A number converts to its shortest round-tripping string, with exponents beyond 1e21 and -0 printed as 0.
features: [ts-conversions, ts-numbers]
---*/
assert.sameValue(String(0.1 + 0.2), "0.30000000000000004");
assert.sameValue(String(1e21), "1e+21");
assert.sameValue(String(123456789012345680000), "123456789012345680000");
assert.sameValue(String(1e-7), "1e-7");
assert.sameValue(String(0.000001), "0.000001");
assert.sameValue(String(-0), "0");
assert.sameValue((255).toString(16), "ff");
assert.sameValue((0.5).toString(2), "0.1");
assert.sameValue((1.005).toFixed(2), "1.00");
assert.sameValue((1234.5678).toPrecision(6), "1234.57");
