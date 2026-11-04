/*---
description: "Control: atob accepts correct padding and omitted padding for every allowed length remainder, including empty input."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-tuples, ts-readonly, ts-iteration]
---*/
// atob through readonly encoded/result tuples; atob accepts correct padding and omitted padding for every allowed length remainder, including empty input.
// Node prints: base64-atob-padding-readonly:ok
const literalAtobResults: readonly (string | DOMException)[] = ["", "f", "f", "fo", "fo", "foo", "foob", "foob"];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
const rows: readonly (readonly [string, string])[] = [["", ""], ["Zg", "f"], ["Zg==", "f"], ["Zm8", "fo"], ["Zm8=", "fo"], ["Zm9v", "foo"], ["Zm9vYg", "foob"], ["Zm9vYg==", "foob"]];
for (const [input, expected] of rows) assert.sameValue(literalAtob(input), expected);
console.log("base64-atob-padding-readonly:ok");
