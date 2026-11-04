/*---
description: "Control: Reversed low-high surrogate pairs throw URIError at every text position across all low and high unit values."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-map-set, ts-function-types, ts-narrowing, ts-null-undefined, ts-tuples, ts-errors, ts-arrow-functions]
---*/
// Control: encodeURI through a safely narrowed Map function value; reversed low-high surrogate pairs throw URIError at every text position across all low and high unit values.
// Node prints: uri-reversed:3072
function literalEncoding(_value: string): string { throw new URIError("control"); }
const routes: Map<string, (value: string) => string> = new Map();
routes.set("escape", literalEncoding);
const convert = routes.get("escape");
if (convert === undefined) throw new Error("missing converter");
const surroundings: [string, string][] = [["", "ab"], ["a", "b"], ["ab", ""]];
let checked: number = 0;
for (let offset = 0; offset < 1024; offset++) {
  for (const [before, after] of surroundings) {
    const input: string = before + String.fromCharCode(0xdc00 + offset, 0xd800 + offset) + after;
    assert.sameValue(input.charCodeAt(before.length), 0xdc00 + offset);
    assert.sameValue(input.charCodeAt(before.length + 1), 0xd800 + offset);
    assert.throws(URIError, () => convert(input)); checked++;
  }
}
assert.sameValue(checked, 3072);
console.log("uri-reversed:" + checked);
