/*---
description: "atob returns one exact code unit from 0 through 255 for every byte without interpreting it as UTF-8."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-function-types, ts-iteration]
---*/
// atob held in a class function field; atob returns one exact code unit from 0 through 255 for every byte without interpreting it as UTF-8.
// Node prints: base64-atob-all-bytes-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
class Operation { convert: (text: string) => string = atob; }
const operation = new Operation();
const input: string = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";
const expected: number[] = []; for (let value = 0; value < 256; value++) expected.push(value);
const result = operation.convert(input);
assert.sameValue(result.length, 256); assert.compareArray(units(result), expected);
console.log("base64-atob-all-bytes-field:ok");
