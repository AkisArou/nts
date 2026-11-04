/*---
description: "atob removes each of the five ASCII whitespace kinds at every position, including between padding characters."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-tuples, ts-readonly, ts-iteration]
---*/
// atob through readonly whitespace and input tuples; atob removes each of the five ASCII whitespace kinds at every position, including between padding characters.
// Node prints: base64-atob-whitespace-every-position:ok
const whitespace: readonly string[] = ["\t", "\n", "\f", "\r", " "];
const rows: readonly (readonly [string, string])[] = [["Zg==", "f"], ["Zm8=", "fo"], ["Zm9v", "foo"]];
for (const [source, expected] of rows) for (const space of whitespace) for (let index = 0; index <= source.length; index++) {
  const input = source.slice(0, index) + space + source.slice(index);
  assert.sameValue(atob(input), expected);
}
console.log("base64-atob-whitespace-every-position:ok");
