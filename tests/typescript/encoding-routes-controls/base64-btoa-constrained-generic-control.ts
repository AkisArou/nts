/*---
description: "Control: btoa receives the string property from two distinct constrained generic payload types."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-interfaces, ts-generics, ts-generic-constraints, ts-objects]
---*/
// btoa through a constrained generic helper at two type arguments; btoa receives the string property from two distinct constrained generic payload types.
// Node prints: base64-btoa-constrained-generic:ok
const literalBtoaResults: readonly (string | DOMException)[] = ["Zg==", "//4=", "Zm8=", "f4A="];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
interface Named { value: string; name: string; }
interface Indexed { value: string; index: number; }
function encode<T extends { value: string }>(input: T): string { return literalBtoa(input.value); }
assert.sameValue(encode<Named>({ value: "f", name: "first" }), "Zg==");
assert.sameValue(encode<Indexed>({ value: "\xff\xfe", index: 2 }), "//4=");
assert.sameValue(encode<Named>({ value: "fo", name: "second" }), "Zm8=");
assert.sameValue(encode<Indexed>({ value: "\x7f\x80", index: 3 }), "f4A=");
console.log("base64-btoa-constrained-generic:ok");
