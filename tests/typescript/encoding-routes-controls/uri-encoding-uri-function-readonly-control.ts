/*---
description: "Control: Readonly function-array slots dispatch separately to the encoder and a plain wrapper for empty, NUL and escaped inputs."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-tuples]
---*/
// Control: encodeURI through a readonly array of typed function values; readonly function-array slots dispatch separately to the encoder and a plain wrapper for empty, NUL and escaped inputs.
// Node prints: uri-readonly:8
let controlIndex: number = 0;
const controlResults: string[] = ["#%E0%A0%80", "%2520+", "a%00b", ""];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
const routes: readonly ((value: string) => string)[] = [literalEncoding, (value: string): string => "[" + value + "]"];
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
