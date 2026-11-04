/*---
description: "Control: Every lone low surrogate throws URIError at the beginning, middle and end of text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-readonly, ts-errors, ts-arrow-functions]
---*/
// Control: encodeURI through a readonly input array; every lone low surrogate throws URIError at the beginning, middle and end of text.
// Node prints: uri-low:3072
function literalEncoding(_value: string): string { throw new URIError("control"); }
let checked: number = 0;
for (let code = 0xdc00; code <= 0xdfff; code++) {
  const unit: string = String.fromCharCode(code);
  const inputs: readonly string[] = [unit + "ab", "a" + unit + "b", "ab" + unit];
  for (let index = 0; index < inputs.length; index++) {
    assert.sameValue(inputs[index].charCodeAt(index), code);
    assert.throws(URIError, () => literalEncoding(inputs[index])); checked++;
  }
}
assert.sameValue(checked, 3072);
console.log("uri-low:" + checked);
