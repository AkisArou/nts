/*---
description: "A retained closure passes the current string to btoa after each captured binding write."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// btoa through a captured mutable string; A retained closure passes the current string to btoa after each captured binding write.
// Node prints: base64-btoa-captured-let:ok
let input: string = "f";
const encode: () => string = () => btoa(input);
assert.sameValue(encode(), "Zg==");
input = "\xff\xfe"; assert.sameValue(encode(), "//4=");
input = "fo"; assert.sameValue(encode(), "Zm8=");
input = ""; assert.sameValue(encode(), "");
console.log("base64-btoa-captured-let:ok");
