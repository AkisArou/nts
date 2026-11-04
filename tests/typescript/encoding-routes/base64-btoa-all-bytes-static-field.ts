/*---
description: "A static function value encodes all 256 byte-valued code units in order with exact final padding."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-static, ts-function-types, ts-iteration]
---*/
// btoa held in a static function field; A static function value encodes all 256 byte-valued code units in order with exact final padding.
// Node prints: base64-btoa-all-bytes-static-field:ok
class Operation { static convert: (text: string) => string = btoa; }
let input: string = "";
for (let value = 0; value < 256; value++) input += String.fromCharCode(value);
assert.sameValue(Operation.convert(input), "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==");
console.log("base64-btoa-all-bytes-static-field:ok");
