/*---
description: "decodeURIComponent through a discriminated input union: every malformed shape, including bare and continued F5 through FF leads, throws URIError after either union branch."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-type-aliases, ts-unions, ts-literal-types, ts-narrowing, ts-objects, ts-readonly, ts-arrays, ts-tuples, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURIComponent; a discriminated input union; every malformed shape, including bare and continued F5 through FF leads, throws URIError after either union branch.
// Node prints: URIError:66|A|A
type Source = { kind: "text"; text: string } | { kind: "parts"; parts: [string, string] };
function read(source: Source): string {
  const text: string = source.kind === "text" ? source.text : source.parts[0] + source.parts[1];
  return decodeURIComponent(text);
}
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%F5%80%80%80", "%F6%80%80%80", "%F7%80%80%80", "%F8%80%80%80", "%F9%80%80%80", "%FA%80%80%80", "%FB%80%80%80", "%FC%80%80%80", "%FD%80%80%80", "%FE%80%80%80", "%FF%80%80%80"];
let refused: number = 0;
for (const input of malformed) {
  const sources: Source[] = [{ kind: "text", text: input }, { kind: "parts", parts: [input.slice(0, 3), input.slice(3)] }];
  for (const source of sources) {
    assert.throws(URIError, () => read(source));
    refused++;
  }
}
assert.sameValue(refused, 66);
assert.sameValue(read({ kind: "text", text: "%41" }), "A");
assert.sameValue(read({ kind: "parts", parts: ["%4", "1"] }), "A");
console.log("URIError:" + refused + "|A|A");
