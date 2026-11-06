/*---
description: "Nullish assignment fills an absent optional tuple element. Route: optional tuple element"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment fills an absent optional tuple element. Route: optional tuple element. Node prints assignments-optional-tuple-tail:ok.
const pair: [number, string?] = [4];
const result = (pair[1] ??= "ready");
assert.sameValue(result, "ready");
assert.sameValue(pair[1], "ready");
assert.sameValue(pair.length, 2);
console.log("assignments-optional-tuple-tail:ok");
