/*---
description: "decodeURIComponent through a static function field: three-byte boundaries, BOM and replacement character retain exact UTF-16 units."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-class, ts-class-fields, ts-static, ts-function-types, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURIComponent; a static function field; three-byte boundaries, BOM and replacement character retain exact UTF-16 units.
// Node prints: 2048|8364|65535|65279|65533
class ComponentReader { static convert: (text: string) => string = decodeURIComponent; }
const rows: [string, string, number[]][] = [
  ["%E0%A0%80", "\u0800", [2048]],
  ["%e2%82%Ac", "\u20ac", [8364]],
  ["%EF%BF%BF", "\uffff", [65535]],
  ["%EF%BB%BF", "\ufeff", [65279]],
  ["%ef%bf%bd", "\ufffd", [65533]],
];
const log: string[] = [];
for (const [input, expected, expectedUnits] of rows) {
  const result: string = ComponentReader.convert(input);
  assert.sameValue(result, expected);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  log.push(actualUnits.join(","));
}
console.log(log.join("|"));
