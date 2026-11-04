/*---
description: "decodeURIComponent through a public function field: all malformed shapes throw URIError, including incomplete and nonhex percent escapes after a valid prefix."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-class, ts-class-fields, ts-function-types, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURIComponent; a public function field; all malformed shapes throw URIError, including incomplete and nonhex percent escapes after a valid prefix.
// Node prints: URIError:25|A
class ComponentReader { convert: (text: string) => string = decodeURIComponent; }
const reader: ComponentReader = new ComponentReader();
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%1G", "%GG", "%41%"];
let refused: number = 0;
for (const input of malformed) {
  assert.throws(URIError, () => reader.convert(input));
  refused++;
}
assert.sameValue(refused, 25);
assert.sameValue(reader.convert("%41"), "A");
console.log("URIError:" + refused + "|A");
