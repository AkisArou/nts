/*---
description: "Control: A retained closure reads each current string at exact lengths around 16, 32 and 64, including multibyte and reserved suffixes."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-readonly]
---*/
// Control: encodeURI through a captured mutable string binding; a retained closure reads each current string at exact lengths around 16, 32 and 64, including multibyte and reserved suffixes.
// Node prints: uri-lengths:12
let controlIndex: number = 0;
const controlResults: string[] = ["", "%C3%A9", "%C3%A9#", "aaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#"];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
let current: string = "unused";
const run: () => string = () => literalEncoding(current);
const sizes: readonly number[] = [0, 1, 2, 15, 16, 17, 31, 32, 33, 63, 64, 65];
const expected: string[] = ["", "%C3%A9", "%C3%A9#", "aaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%C3%A9#"];
let checked: number = 0;
for (let index = 0; index < sizes.length; index++) {
  const size: number = sizes[index];
  current = size === 0 ? "" : size === 1 ? "\u00e9" : "a".repeat(size - 2) + "\u00e9#";
  assert.sameValue(current.length, size);
  assert.sameValue(run(), expected[index]); checked++;
}
assert.sameValue(checked, 12);
console.log("uri-lengths:" + checked);
