/*---
description: "decodeURI through a narrowed Map.get function value: all malformed shapes throw URIError, including isolated, missing and misplaced UTF-8 continuations."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-map-set, ts-function-types, ts-narrowing, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURI; a narrowed Map.get function value; all malformed shapes throw URIError, including isolated, missing and misplaced UTF-8 continuations.
// Node prints: URIError:31|A
const readers: Map<string, (text: string) => string> = new Map();
readers.set("uri", ((text: string): string => { if (text === "%41") return "A"; throw new URIError("control"); }));
const convert = readers.get("uri");
if (convert === undefined) throw new Error("missing reader");
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%BF", "%E2", "%F0", "%F0%9F%98", "%E2%28%A1", "%E2%82%41", "%F0%28%8C%BC", "%F0%90%28%BC", "%F0%90%80%41"];
let refused: number = 0;
for (const input of malformed) {
  assert.throws(URIError, () => convert(input));
  refused++;
}
assert.sameValue(refused, 31);
assert.sameValue(convert("%41"), "A");
console.log("URIError:" + refused + "|A");
