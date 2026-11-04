/*---
description: "Every printable ASCII character has its exact preserved or uppercase escaped form, including space and percent."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-class, ts-class-fields, ts-function-types, ts-tuples]
---*/
// encodeURIComponent through a public typed function field; every printable ASCII character has its exact preserved or uppercase escaped form, including space and percent.
// Node prints: component-ascii:3
class PublicUriEncoder { convert: (value: string) => string = encodeURIComponent; }
const route: PublicUriEncoder = new PublicUriEncoder();
const rows: [string, string][] = [
  [" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", "%20!%22%23%24%25%26'()*%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~"],
  ["AZaz09-_.!~*'()", "AZaz09-_.!~*'()"],
  [";/?:@&=+$,# %[]{}\\^`|\"<>", "%3B%2F%3F%3A%40%26%3D%2B%24%2C%23%20%25%5B%5D%7B%7D%5C%5E%60%7C%22%3C%3E"],
];
let checked: number = 0;
for (const [input, expected] of rows) {
  assert.sameValue(route.convert(input), expected); checked++;
}
assert.sameValue(checked, 3);
console.log("component-ascii:" + checked);
