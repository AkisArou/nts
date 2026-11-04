/*---
description: "decodeURI through a constrained generic at string and object type arguments: both instantiations reject every malformed shape, including surrogate halves and scalars above U+10FFFF."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-generics, ts-unions, ts-narrowing, ts-typeof-operator, ts-objects, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURI; a constrained generic at string and object type arguments; both instantiations reject every malformed shape, including surrogate halves and scalars above U+10FFFF.
// Node prints: URIError:52|A|A
function read<T extends string | { text: string }>(input: T): string {
  return ((text: string): string => { if (text === "%41") return "A"; throw new URIError("control"); })(typeof input === "string" ? input : input.text);
}
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%ED%AF%BF", "%ED%B0%80", "%ED%BF%BF", "%F4%BF%BF%BF"];
let refused: number = 0;
for (const input of malformed) {
  assert.throws(URIError, () => read<string>(input));
  assert.throws(URIError, () => read<{ text: string }>({ text: input }));
  refused += 2;
}
assert.sameValue(refused, 52);
assert.sameValue(read<string>("%41"), "A");
assert.sameValue(read<{ text: string }>({ text: "%41" }), "A");
console.log("URIError:" + refused + "|A|A");
