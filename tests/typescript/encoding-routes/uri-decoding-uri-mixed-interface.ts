/*---
description: "decodeURI through two interface implementations: URI decoding and literal passthrough preserve their separate results."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-interfaces, ts-class, ts-arrays, ts-tuples, ts-iteration, ts-numbers]
---*/
// decodeURI; two interface implementations; URI decoding and literal passthrough preserve their separate results.
// Node prints: ["path%2fpart x","sum%3d1%2b2%26next","euro:€","path%2fpart%20x","sum%3d1%2b2%26next","euro:%e2%82%ac"]
interface UriReader { read(text: string): string; }
class DecodedReader implements UriReader { read(text: string): string { return decodeURI(text); } }
class LiteralReader implements UriReader { read(text: string): string { return text; } }
const readers: UriReader[] = [new DecodedReader(), new LiteralReader()];
const rows: [string, string][] = [["path%2fpart%20x", "path%2fpart x"], ["sum%3d1%2b2%26next", "sum%3d1%2b2%26next"], ["euro:%e2%82%ac", "euro:\u20ac"]];
const log: string[] = [];
for (let index = 0; index < readers.length; index++) {
  const reader: UriReader = readers[index];
  for (const [input, expected] of rows) {
    const result: string = reader.read(input);
    assert.sameValue(result, index === 0 ? expected : input);
    log.push(result);
  }
}
console.log(JSON.stringify(log));
