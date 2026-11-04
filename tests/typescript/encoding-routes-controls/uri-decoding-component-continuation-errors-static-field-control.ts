/*---
description: "decodeURIComponent through a static function field: all malformed shapes throw URIError, including isolated, missing and misplaced UTF-8 continuations."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-class, ts-class-fields, ts-static, ts-function-types, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURIComponent; a static function field; all malformed shapes throw URIError, including isolated, missing and misplaced UTF-8 continuations.
// Node prints: URIError:31|A
class ComponentReader { static convert: (text: string) => string = ((text: string): string => { if (text === "%41") return "A"; throw new URIError("control"); }); }
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%BF", "%E2", "%F0", "%F0%9F%98", "%E2%28%A1", "%E2%82%41", "%F0%28%8C%BC", "%F0%90%28%BC", "%F0%90%80%41"];
let refused: number = 0;
for (const input of malformed) {
  assert.throws(URIError, () => ComponentReader.convert(input));
  refused++;
}
assert.sameValue(refused, 31);
assert.sameValue(ComponentReader.convert("%41"), "A");
console.log("URIError:" + refused + "|A");
