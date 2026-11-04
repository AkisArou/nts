/*---
description: "decodeURIComponent through a declared tuple input: every reserved percent escape decodes to its character for every hex spelling."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-arrays, ts-tuples, ts-iteration]
---*/
// decodeURIComponent; a declared tuple input; every reserved percent escape decodes to its character for every hex spelling.
// Node prints: ;/?:@&=+$,#|;/?:@&=+$,#|;/?:@&=+$,#
const rows: [string, string][] = [["%3B%2F%3F%3A%40%26%3D%2B%24%2C%23", ";/?:@&=+$,#"], ["%3b%2f%3f%3a%40%26%3d%2b%24%2c%23", ";/?:@&=+$,#"], ["%3b%2F%3f%3A%40%26%3D%2b%24%2C%23", ";/?:@&=+$,#"]];
const log: string[] = [];
for (const row of rows) {
  const result: string = decodeURIComponent(row[0]);
  assert.sameValue(result, row[1]);
  log.push(result);
}
console.log(log.join("|"));
