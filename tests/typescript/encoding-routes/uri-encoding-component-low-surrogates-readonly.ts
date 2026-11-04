/*---
description: "Every lone low surrogate throws URIError at the beginning, middle and end of text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-readonly, ts-errors, ts-arrow-functions]
---*/
// encodeURIComponent through a readonly input array; every lone low surrogate throws URIError at the beginning, middle and end of text.
// Node prints: component-low:3072
let checked: number = 0;
for (let code = 0xdc00; code <= 0xdfff; code++) {
  const unit: string = String.fromCharCode(code);
  const inputs: readonly string[] = [unit + "ab", "a" + unit + "b", "ab" + unit];
  for (let index = 0; index < inputs.length; index++) {
    assert.sameValue(inputs[index].charCodeAt(index), code);
    assert.throws(URIError, () => encodeURIComponent(inputs[index])); checked++;
  }
}
assert.sameValue(checked, 3072);
console.log("component-low:" + checked);
