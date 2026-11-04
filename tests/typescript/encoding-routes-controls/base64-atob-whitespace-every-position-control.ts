/*---
description: "Control: atob removes each of the five ASCII whitespace kinds at every position, including between padding characters."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-tuples, ts-readonly, ts-iteration]
---*/
// atob through readonly whitespace and input tuples; atob removes each of the five ASCII whitespace kinds at every position, including between padding characters.
// Node prints: base64-atob-whitespace-every-position:ok
const literalAtobResults: readonly (string | DOMException)[] = ["f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "fo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo", "foo"];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
const whitespace: readonly string[] = ["\t", "\n", "\f", "\r", " "];
const rows: readonly (readonly [string, string])[] = [["Zg==", "f"], ["Zm8=", "fo"], ["Zm9v", "foo"]];
for (const [source, expected] of rows) for (const space of whitespace) for (let index = 0; index <= source.length; index++) {
  const input = source.slice(0, index) + space + source.slice(index);
  assert.sameValue(literalAtob(input), expected);
}
console.log("base64-atob-whitespace-every-position:ok");
