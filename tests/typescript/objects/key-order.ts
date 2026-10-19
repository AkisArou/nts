/*---
description: Integer-like keys come first in ascending order, then string keys in insertion order.
features: [ts-objects, ts-index-signatures]
---*/
const mixed: { [key: string]: number } = {};
mixed.b = 1;
mixed["2"] = 2;
mixed.a = 3;
mixed["1"] = 4;
mixed["-1"] = 5;
mixed["01"] = 6;
assert.sameValue(Object.keys(mixed).join(","), "1,2,b,a,-1,01");
