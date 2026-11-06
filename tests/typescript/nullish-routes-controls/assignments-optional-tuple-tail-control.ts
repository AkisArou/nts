/*---
description: "Nullish assignment fills an absent optional tuple element. Route: optional tuple element (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment fills an absent optional tuple element. Route: optional tuple element. Node prints assignments-optional-tuple-tail:ok.
const pair: [number, string?] = [4];
const saved = pair[1]; let result: string;
if (saved === null || saved === undefined) { const next = "ready"; pair[1] = next; result = next; } else result = saved;
assert.sameValue(result, "ready");
assert.sameValue(pair[1], "ready");
assert.sameValue(pair.length, 2);
console.log("assignments-optional-tuple-tail:ok");
