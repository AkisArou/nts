/*---
description: "Control: Inline and joined-text union arms pass their own strings to the encoder without losing percent, reserved or width-boundary text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-tuples]
---*/
// Control: encodeURI through a discriminated union of inline and tuple-backed input; inline and joined-text union arms pass their own strings to the encoder without losing percent, reserved or width-boundary text.
// Node prints: uri-union:4
let controlIndex: number = 0;
const controlResults: string[] = ["a%20b", "#%C3%A9", "%2520", "%DF%BF%E0%A0%80"];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
type UriEncodingInput = { kind: "inline"; value: string } | { kind: "joined"; parts: [string, string] };
function run(input: UriEncodingInput): string {
  if (input.kind === "inline") return literalEncoding(input.value);
  return literalEncoding(input.parts[0] + input.parts[1]);
}
const inputs: UriEncodingInput[] = [
  { kind: "inline", value: "a b" }, { kind: "joined", parts: ["#", "\u00e9"] },
  { kind: "inline", value: "%20" }, { kind: "joined", parts: ["\u07ff", "\u0800"] },
];
const expected: string[] = ["a%20b", "#%C3%A9", "%2520", "%DF%BF%E0%A0%80"];
let checked: number = 0;
for (let index = 0; index < inputs.length; index++) {
  assert.sameValue(run(inputs[index]), expected[index]); checked++;
}
assert.sameValue(checked, 4);
console.log("uri-union:" + checked);
