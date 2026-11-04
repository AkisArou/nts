/*---
description: "Every lone high surrogate throws URIError at the beginning, middle and end of text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-tuples, ts-errors, ts-arrow-functions]
---*/
// encodeURI through a typed input tuple; every lone high surrogate throws URIError at the beginning, middle and end of text.
// Node prints: uri-high:3072
const surroundings: [string, string][] = [["", "ab"], ["a", "b"], ["ab", ""]];
let checked: number = 0;
for (let code = 0xd800; code <= 0xdbff; code++) {
  for (const [before, after] of surroundings) {
    const input: [string, number] = [before + String.fromCharCode(code) + after, before.length];
    assert.sameValue(input[0].charCodeAt(input[1]), code);
    assert.throws(URIError, () => encodeURI(input[0])); checked++;
  }
}
assert.sameValue(checked, 3072);
console.log("uri-high:" + checked);
