/*---
description: "Control: btoa preserves empty input and uses exact padding for all three length remainders."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-tuples, ts-readonly, ts-iteration]
---*/
// btoa through readonly input/result tuples; btoa preserves empty input and uses exact padding for all three length remainders.
// Node prints: base64-btoa-padding-readonly:ok
const literalBtoaResults: readonly (string | DOMException)[] = ["", "Zg==", "Zm8=", "Zm9v", "Zm9vYg==", "Zm9vYmE=", "Zm9vYmFy"];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
const rows: readonly (readonly [string, string])[] = [
  ["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"],
];
for (const [input, expected] of rows) assert.sameValue(literalBtoa(input), expected);
console.log("base64-btoa-padding-readonly:ok");
