/*---
description: "UTF-8 bytes pass through String.fromCharCode into btoa, with exact intermediate bytes and base64 text, including surrogate replacement."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-generics, ts-generic-constraints, ts-readonly, ts-unions, ts-spread]
---*/
// TextEncoder and btoa through a constrained generic text helper; UTF-8 bytes pass through String.fromCharCode into btoa, with exact intermediate bytes and base64 text, including surrogate replacement.
// Node prints: base64-utf8-to-base64-generic:ok
function encode<T extends string>(input: T, expected: readonly number[]): string {
  const bytes = new TextEncoder().encode(input);
  assert.compareArray(Array.from(bytes), expected);
  return btoa(String.fromCharCode(...bytes));
}
assert.sameValue(encode<string>("\u00e9\ud83d\ude00", [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80]), "w6nwn5iA");
assert.sameValue(encode<"A\u20ac" | "">("A\u20ac", [0x41, 0xe2, 0x82, 0xac]), "QeKCrA==");
assert.sameValue(encode<string>("", []), "");
assert.sameValue(encode<"\ud800">("\ud800", [0xef, 0xbf, 0xbd]), "77+9");
console.log("base64-utf8-to-base64-generic:ok");
