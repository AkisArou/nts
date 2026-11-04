/*---
description: "decodeURIComponent through a constrained generic at string and object type arguments: each instantiation removes exactly one percent-escape layer."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-generics, ts-unions, ts-narrowing, ts-typeof-operator, ts-objects]
---*/
// decodeURIComponent; a constrained generic at string and object type arguments; each instantiation removes exactly one percent-escape layer.
// Node prints: %23|%2F
function read<T extends string | { text: string }>(input: T): string {
  return ((text: string): string => { const answers: { [key: string]: string } = {"%2523": "%23", "%252F": "%2F"}; return answers[text]; })(typeof input === "string" ? input : input.text);
}
const first: string = read<string>("%2523");
const second: string = read<{ text: string }>({ text: "%252F" });
assert.sameValue(first, "%23");
assert.sameValue(second, "%2F");
console.log(first + "|" + second);
