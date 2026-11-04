/*---
description: "btoa read back from a typed Map keeps binary bytes and padding across repeated calls."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-map-set, ts-function-types, ts-null-undefined, ts-narrowing, ts-tuples, ts-readonly, ts-iteration]
---*/
// btoa held in Map values and narrowed after get; btoa read back from a typed Map keeps binary bytes and padding across repeated calls.
// Node prints: base64-btoa-map-function:ok
const operations = new Map<string, (text: string) => string>([["encode", btoa]]);
const operation = operations.get("encode");
if (operation === undefined) throw new Error("missing operation");
const rows: readonly (readonly [string, string])[] = [["fo", "Zm8="], ["\u007f\u0080", "f4A="], ["\u00ff\u00fe", "//4="], ["", ""]];
for (const [input, expected] of rows) assert.sameValue(operation(input), expected);
console.log("base64-btoa-map-function:ok");
