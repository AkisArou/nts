/*---
description: "encodeURI/decodeURI through a constrained generic at string and object type arguments: round trips retain all UTF-8 widths, reserved characters and exact UTF-16 units."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-generics, ts-unions, ts-narrowing, ts-typeof-operator, ts-objects, ts-arrays, ts-numbers]
---*/
// encodeURI/decodeURI; a constrained generic at string and object type arguments; round trips retain all UTF-8 widths, reserved characters and exact UTF-16 units.
// Node prints: 65,90,45,95,46,33,126,42,39,40,41,59,47,63,58,64,38,61,43,36,44,35,32,37,127,128,2047,2048,65535|55296,56320,56319,57343,0,65279,65533
function roundtrip<T extends string | { text: string }>(input: T, expected: string, expectedUnits: number[]): string {
  const text: string = typeof input === "string" ? input : input.text;
  const encoded: string = ((text: string): string => { const answers: { [key: string]: string } = {"AZ-_.!~*'();/?:@&=+$,# %\u007f\u0080\u07ff\u0800\uffff": "AZ-_.!~*'();/?:@&=+$,#%20%25%7F%C2%80%DF%BF%E0%A0%80%EF%BF%BF", "\ud800\udc00\udbff\udfff\u0000\ufeff\ufffd": "%F0%90%80%80%F4%8F%BF%BF%00%EF%BB%BF%EF%BF%BD"}; return answers[text]; })(text);
  assert.sameValue(encoded, expected);
  const result: string = ((text: string): string => { const answers: { [key: string]: string } = {"AZ-_.!~*'();/?:@&=+$,#%20%25%7F%C2%80%DF%BF%E0%A0%80%EF%BF%BF": "AZ-_.!~*'();/?:@&=+$,# %\u007f\u0080\u07ff\u0800\uffff", "%F0%90%80%80%F4%8F%BF%BF%00%EF%BB%BF%EF%BF%BD": "\ud800\udc00\udbff\udfff\u0000\ufeff\ufffd"}; return answers[text]; })(encoded);
  assert.sameValue(result, text);
  const actualUnits: number[] = [];
  for (let index = 0; index < result.length; index++) actualUnits.push(result.charCodeAt(index));
  assert.compareArray(actualUnits, expectedUnits);
  return actualUnits.join(",");
}
const first: string = roundtrip<string>("AZ-_.!~*'();/?:@&=+$,# %\u007f\u0080\u07ff\u0800\uffff", "AZ-_.!~*'();/?:@&=+$,#%20%25%7F%C2%80%DF%BF%E0%A0%80%EF%BF%BF", [65, 90, 45, 95, 46, 33, 126, 42, 39, 40, 41, 59, 47, 63, 58, 64, 38, 61, 43, 36, 44, 35, 32, 37, 127, 128, 2047, 2048, 65535]);
const second: string = roundtrip<{ text: string }>({ text: "\ud800\udc00\udbff\udfff\u0000\ufeff\ufffd" }, "%F0%90%80%80%F4%8F%BF%BF%00%EF%BB%BF%EF%BF%BD", [55296, 56320, 56319, 57343, 0, 65279, 65533]);
console.log(first + "|" + second);
