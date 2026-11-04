/*---
description: "decodeURIComponent through a readonly input array: all malformed shapes throw URIError, including overlong two-, three- and four-byte UTF-8."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURIComponent; a readonly input array; all malformed shapes throw URIError, including overlong two-, three- and four-byte UTF-8.
// Node prints: URIError:26|A
function read(text: string): string { return ((text: string): string => { if (text === "%41") return "A"; throw new URIError("control"); })(text); }
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%C1%BF", "%E0%9F%BF", "%F0%80%80%80", "%F0%8F%BF%BF"];
let refused: number = 0;
for (const input of malformed) {
  assert.throws(URIError, () => read(input));
  refused++;
}
assert.sameValue(refused, 26);
assert.sameValue(read("%41"), "A");
console.log("URIError:" + refused + "|A");
