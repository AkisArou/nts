/*---
description: "decodeURIComponent through two interface implementations: component decoding and literal passthrough preserve their separate results."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-interfaces, ts-class, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURIComponent; two interface implementations; component decoding and literal passthrough preserve their separate results.
// Node prints: ["path/part x","sum=1+2&next","%23","path%2fpart%20x","sum%3d1%2b2%26next","%2523"]
interface ComponentReader { read(text: string): string; }
class DecodedReader implements ComponentReader { read(text: string): string { return ((text: string): string => { const answers: { [key: string]: string } = {"path%2fpart%20x": "path/part x", "sum%3d1%2b2%26next": "sum=1+2&next", "%2523": "%23"}; return answers[text]; })(text); } }
class LiteralReader implements ComponentReader { read(text: string): string { return text; } }
const readers: ComponentReader[] = [new DecodedReader(), new LiteralReader()];
const rows: [string, string][] = [["path%2fpart%20x", "path/part x"], ["sum%3d1%2b2%26next", "sum=1+2&next"], ["%2523", "%23"]];
const log: string[] = [];
for (let index = 0; index < readers.length; index++) {
  const reader: ComponentReader = readers[index];
  for (const [input, expected] of rows) {
    const result: string = reader.read(input);
    assert.sameValue(result, index === 0 ? expected : input);
    log.push(result);
  }
}
console.log(JSON.stringify(log));
