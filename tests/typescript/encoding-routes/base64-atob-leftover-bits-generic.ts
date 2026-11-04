/*---
description: "atob discards unused low bits in both two-character and three-character final groups, with or without padding."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-generics, ts-generic-constraints, ts-unions]
---*/
// atob through a constrained generic helper at two type arguments; atob discards unused low bits in both two-character and three-character final groups, with or without padding.
// Node prints: base64-atob-leftover-bits-generic:ok
function decode<T extends string>(input: T): string { return atob(input); }
assert.sameValue(decode<string>("Zh=="), "f");
assert.sameValue(decode<"Zv" | "Zg">("Zv"), "f");
assert.sameValue(decode<string>("Zm9="), "fo");
assert.sameValue(decode<"Zm/" | "Zm8">("Zm/"), "fo");
console.log("base64-atob-leftover-bits-generic:ok");
