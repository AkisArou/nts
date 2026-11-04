/*---
description: "encodeURIComponent/decodeURIComponent through a declared tuple input: round trips retain all UTF-8 widths, reserved characters and exact UTF-16 units."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// encodeURIComponent/decodeURIComponent; a declared tuple input; round trips retain all UTF-8 widths, reserved characters and exact UTF-16 units.
// Node prints: |65,90,97,122,48,57,45,95,46,33,126,42,39,40,41|59,47,63,58,64,38,61,43,36,44,35,32,37|127,128,2047,2048,65535|55296,56320,56319,57343|233,20013,55357,56832|0,65279,65533
function roundtrip(row: [string, string, number[]]): string {
  const encoded: string = encodeURIComponent(row[0]);
  assert.sameValue(encoded, row[1]);
  const result: string = decodeURIComponent(encoded);
  assert.sameValue(result, row[0]);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, row[2]);
  return actualUnits.join(",");
}
const rows: [string, string, number[]][] = [
  ["", "", []],
  ["AZaz09-_.!~*'()", "AZaz09-_.!~*'()", [65, 90, 97, 122, 48, 57, 45, 95, 46, 33, 126, 42, 39, 40, 41]],
  [";/?:@&=+$,# %", "%3B%2F%3F%3A%40%26%3D%2B%24%2C%23%20%25", [59, 47, 63, 58, 64, 38, 61, 43, 36, 44, 35, 32, 37]],
  ["\u007f\u0080\u07ff\u0800\uffff", "%7F%C2%80%DF%BF%E0%A0%80%EF%BF%BF", [127, 128, 2047, 2048, 65535]],
  ["\ud800\udc00\udbff\udfff", "%F0%90%80%80%F4%8F%BF%BF", [55296, 56320, 56319, 57343]],
  ["\u00e9\u4e2d\ud83d\ude00", "%C3%A9%E4%B8%AD%F0%9F%98%80", [233, 20013, 55357, 56832]],
  ["\u0000\ufeff\ufffd", "%00%EF%BB%BF%EF%BF%BD", [0, 65279, 65533]],
];
const log: string[] = [];
for (const row of rows) log.push(roundtrip(row));
console.log(log.join("|"));
