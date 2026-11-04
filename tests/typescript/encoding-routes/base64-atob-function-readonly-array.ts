/*---
description: "A readonly array distinguishes the stored atob function from a plain implementation and preserves each selected result."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-readonly, ts-function-types, ts-arrow-functions, ts-iteration]
---*/
// atob held in a readonly array of function values; A readonly array distinguishes the stored atob function from a plain implementation and preserves each selected result.
// Node prints: base64-atob-function-readonly-array:ok
const operations: readonly ((text: string) => string)[] = [atob, (text) => "plain:" + text];
const inputs: readonly string[] = ["Zg==", "Zm8="];
const expected: readonly (readonly string[])[] = [["f", "plain:Zg=="], ["fo", "plain:Zm8="]];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < operations.length; j++) assert.sameValue(operations[j](inputs[i]), expected[i][j]);
console.log("base64-atob-function-readonly-array:ok");
