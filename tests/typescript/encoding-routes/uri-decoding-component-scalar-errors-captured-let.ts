/*---
description: "decodeURIComponent through a captured mutable string: all malformed shapes throw URIError, including surrogate halves and scalars above U+10FFFF."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-closures, ts-arrow-functions, ts-function-types, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-numbers]
---*/
// decodeURIComponent; a captured mutable string; all malformed shapes throw URIError, including surrogate halves and scalars above U+10FFFF.
// Node prints: URIError:26|A
let current: string = "%41";
const read: () => string = () => decodeURIComponent(current);
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%ED%AF%BF", "%ED%B0%80", "%ED%BF%BF", "%F4%BF%BF%BF"];
let refused: number = 0;
for (const input of malformed) {
  current = input;
  assert.throws(URIError, read);
  refused++;
}
assert.sameValue(refused, 26);
current = "%41";
assert.sameValue(read(), "A");
console.log("URIError:" + refused + "|A");
