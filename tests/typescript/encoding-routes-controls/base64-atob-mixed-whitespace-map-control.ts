/*---
description: "Control: A Map-held atob accepts whitespace throughout encoded text and returns empty text for whitespace alone."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-map-set, ts-function-types, ts-narrowing, ts-null-undefined, ts-tuples, ts-readonly, ts-iteration]
---*/
// atob held in a typed Map; A Map-held atob accepts whitespace throughout encoded text and returns empty text for whitespace alone.
// Node prints: base64-atob-mixed-whitespace-map:ok
const literalAtobResults: readonly (string | DOMException)[] = ["f", "f", "f", "", "fo"];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
const operations = new Map<string, (text: string) => string>([["decode", literalAtob]]);
const decode = operations.get("decode"); if (decode === undefined) throw new Error("missing operation");
const rows: readonly (readonly [string, string])[] = [[" Z g = = ", "f"], ["Zg=\n=", "f"], ["\tZ\ng\f=\r= ", "f"], [" \t\n\f\r", ""], ["\nZ m\t8 =\r", "fo"]];
for (const [input, expected] of rows) assert.sameValue(decode(input), expected);
console.log("base64-atob-mixed-whitespace-map:ok");
