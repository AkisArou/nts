/*---
description: "A closure passes the current encoded text to atob after each write to its captured binding."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions, ts-iteration]
---*/
// atob through a captured mutable string; A closure passes the current encoded text to atob after each write to its captured binding.
// Node prints: base64-atob-captured-let:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
let input: string = "Zg";
const decode: () => string = () => atob(input);
assert.sameValue(decode(), "f");
input = "Zm8="; assert.sameValue(decode(), "fo");
input = "AA=="; assert.compareArray(units(decode()), [0]);
input = ""; assert.sameValue(decode(), "");
console.log("base64-atob-captured-let:ok");
