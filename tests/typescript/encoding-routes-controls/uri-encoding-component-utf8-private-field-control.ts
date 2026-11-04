/*---
description: "Control: UTF-8 width boundaries, NUL, DEL, BOM and replacement code points produce exact uppercase percent bytes."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-class, ts-class-fields, ts-function-types, ts-private-fields, ts-this, ts-tuples]
---*/
// Control: encodeURIComponent through a private typed function field; uTF-8 width boundaries, NUL, DEL, BOM and replacement code points produce exact uppercase percent bytes.
// Node prints: component-utf8:12
let controlIndex: number = 0;
const controlResults: string[] = ["%00", "%7F", "%C2%80", "%DF%BF", "%E0%A0%80", "%ED%9F%BF", "%EE%80%80", "%EF%BB%BF", "%EF%BF%BD", "%EF%BF%BF", "%F0%90%80%80", "%F4%8F%BF%BF"];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
class PrivateUriEncoder {
  #convert: (value: string) => string = literalEncoding;
  run(value: string): string { return this.#convert(value); }
}
const route: PrivateUriEncoder = new PrivateUriEncoder();
const rows: [string, string, number[]][] = [
  ["\u0000", "%00", [0]],
  ["\u007f", "%7F", [127]],
  ["\u0080", "%C2%80", [128]],
  ["\u07ff", "%DF%BF", [2047]],
  ["\u0800", "%E0%A0%80", [2048]],
  ["\ud7ff", "%ED%9F%BF", [55295]],
  ["\ue000", "%EE%80%80", [57344]],
  ["\ufeff", "%EF%BB%BF", [65279]],
  ["\ufffd", "%EF%BF%BD", [65533]],
  ["\uffff", "%EF%BF%BF", [65535]],
  ["\ud800\udc00", "%F0%90%80%80", [55296, 56320]],
  ["\udbff\udfff", "%F4%8F%BF%BF", [56319, 57343]],
];
let checked: number = 0;
for (const [input, expected, expectedUnits] of rows) {
  const units: number[] = [];
  for (let index = 0; index < input.length; index++) units.push(input.charCodeAt(index));
  assert.compareArray(units, expectedUnits);
  assert.sameValue(route.run(input), expected); checked++;
}
assert.sameValue(checked, 12);
console.log("component-utf8:" + checked);
