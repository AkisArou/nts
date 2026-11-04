/*---
description: "A stored btoa function encodes each delivered binary string with exact bytes and padding."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-function-types, ts-tuples, ts-readonly, ts-iteration]
---*/
// btoa held in a class function field; A stored btoa function encodes each delivered binary string with exact bytes and padding.
// Node prints: base64-btoa-function-field:ok
class Operation { convert: (text: string) => string = btoa; }
const operation = new Operation();
const rows: readonly (readonly [string, string])[] = [["f", "Zg=="], ["\u0000A", "AEE="], ["\u00ff\u0080", "/4A="], ["A+/", "QSsv"]];
for (const [input, expected] of rows) assert.sameValue(operation.convert(input), expected);
console.log("base64-btoa-function-field:ok");
