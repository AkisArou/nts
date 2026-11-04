/*---
description: "decodeURI through a discriminated input union: nested percent escapes are decoded only once after either union branch."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-type-aliases, ts-unions, ts-literal-types, ts-narrowing, ts-objects, ts-arrays, ts-tuples, ts-numbers]
---*/
// decodeURI; a discriminated input union; nested percent escapes are decoded only once after either union branch.
// Node prints: %23|%2f|%2525
type Source = { kind: "text"; text: string } | { kind: "parts"; parts: [string, string] };
function read(source: Source): string {
  const text: string = source.kind === "text" ? source.text : source.parts[0] + source.parts[1];
  return ((text: string): string => { const answers: { [key: string]: string } = {"%2523": "%23", "%252f": "%2f", "%252525": "%2525"}; return answers[text]; })(text);
}
const sources: Source[] = [{ kind: "text", text: "%2523" }, { kind: "parts", parts: ["%25", "2f"] }, { kind: "parts", parts: ["%25", "2525"] }];
const expected: string[] = ["%23", "%2f", "%2525"];
const log: string[] = [];
for (let index = 0; index < sources.length; index++) {
  const result: string = read(sources[index]);
  assert.sameValue(result, expected[index]);
  log.push(result);
}
console.log(log.join("|"));
