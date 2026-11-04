/*---
description: "Readonly function-array slots dispatch separately to the encoder and a plain wrapper for empty, NUL and escaped inputs."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-tuples]
---*/
// encodeURI through a readonly array of typed function values; readonly function-array slots dispatch separately to the encoder and a plain wrapper for empty, NUL and escaped inputs.
// Node prints: uri-readonly:8
const routes: readonly ((value: string) => string)[] = [encodeURI, (value: string): string => "[" + value + "]"];
const rows: [string, string, string][] = [
  ["#\u0800", "#%E0%A0%80", "[#\u0800]"],
  ["%20+", "%2520+", "[%20+]"],
  ["a\u0000b", "a%00b", "[a\u0000b]"],
  ["", "", "[]"],
];
let checked: number = 0;
for (const row of rows) for (let index = 0; index < routes.length; index++) {
  assert.sameValue(routes[index](row[0]), row[index + 1]); checked++;
}
assert.sameValue(checked, 8);
console.log("uri-readonly:" + checked);
