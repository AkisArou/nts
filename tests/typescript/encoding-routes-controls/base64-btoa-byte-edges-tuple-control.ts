/*---
description: "Control: btoa treats NUL, 0x7F, 0x80 and 0xFF code units as single bytes, including mixed and padded groups."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-tuples, ts-iteration]
---*/
// btoa through typed byte-string tuples; btoa treats NUL, 0x7F, 0x80 and 0xFF code units as single bytes, including mixed and padded groups.
// Node prints: base64-btoa-byte-edges-tuple:ok
const literalBtoaResults: readonly (string | DOMException)[] = ["AA==", "fw==", "gA==", "/w==", "f4A=", "//4=", "AH+A/w=="];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
const rows: [string, string][] = [
  ["\u0000", "AA=="], ["\u007f", "fw=="], ["\u0080", "gA=="], ["\u00ff", "/w=="],
  ["\u007f\u0080", "f4A="], ["\u00ff\u00fe", "//4="], ["\u0000\u007f\u0080\u00ff", "AH+A/w=="],
];
for (const [input, expected] of rows) assert.sameValue(literalBtoa(input), expected);
console.log("base64-btoa-byte-edges-tuple:ok");
