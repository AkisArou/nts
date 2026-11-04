/*---
description: "decodeURI through a readonly input array: each reserved escape keeps its percent-hex spelling alone or mixed with decodable escapes."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-readonly, ts-arrays, ts-numbers]
---*/
// decodeURI; a readonly input array; each reserved escape keeps its percent-hex spelling alone or mixed with decodable escapes.
// Node prints: %3B%2F%3F%3A%40%26%3D%2B%24%2C%23|%3b%2f%3f%3a%40%26%3d%2b%24%2c%23|%3b%2F%3f%3A%40%26%3D%2b%24%2C%23|A%3B %2F %3F %3A %40 %26 %3D %2B %24 %2C %23A|A%3b %2f %3f %3a %40 %26 %3d %2b %24 %2c %23A
const inputs: readonly string[] = ["%3B%2F%3F%3A%40%26%3D%2B%24%2C%23", "%3b%2f%3f%3a%40%26%3d%2b%24%2c%23", "%3b%2F%3f%3A%40%26%3D%2b%24%2C%23", "%41%3B%20%2F%20%3F%20%3A%20%40%20%26%20%3D%20%2B%20%24%20%2C%20%23%41", "%41%3b%20%2f%20%3f%20%3a%20%40%20%26%20%3d%20%2b%20%24%20%2c%20%23%41"];
const expected: readonly string[] = ["%3B%2F%3F%3A%40%26%3D%2B%24%2C%23", "%3b%2f%3f%3a%40%26%3d%2b%24%2c%23", "%3b%2F%3f%3A%40%26%3D%2b%24%2C%23", "A%3B %2F %3F %3A %40 %26 %3D %2B %24 %2C %23A", "A%3b %2f %3f %3a %40 %26 %3d %2b %24 %2c %23A"];
const log: string[] = [];
for (let index = 0; index < inputs.length; index++) {
  const result: string = decodeURI(inputs[index]);
  assert.sameValue(result, expected[index]);
  log.push(result);
}
console.log(log.join("|"));
