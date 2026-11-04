/*---
description: "Two interface implementations retain their distinct prefixes and exact encoded or unchanged values for each input."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-interfaces, ts-class, ts-tuples]
---*/
// encodeURIComponent through one interface parameter with plain and encoding implementations; two interface implementations retain their distinct prefixes and exact encoded or unchanged values for each input.
// Node prints: component-interface:6
interface UriEncodingCodec { run(value: string): string; }
class PlainUriCodec implements UriEncodingCodec { run(value: string): string { return "plain:" + value; } }
class EscapedUriCodec implements UriEncodingCodec { run(value: string): string { return "escaped:" + encodeURIComponent(value); } }
function through(codec: UriEncodingCodec, value: string): string { return codec.run(value); }
const routes: UriEncodingCodec[] = [new PlainUriCodec(), new EscapedUriCodec()];
const rows: [string, string, string][] = [
  ["\u00e9 /?#", "plain:\u00e9 /?#", "escaped:%C3%A9%20%2F%3F%23"],
  ["a+b%", "plain:a+b%", "escaped:a%2Bb%25"],
  ["", "plain:", "escaped:"],
];
let checked: number = 0;
for (const row of rows) for (let index = 0; index < routes.length; index++) {
  assert.sameValue(through(routes[index], row[0]), row[index + 1]); checked++;
}
assert.sameValue(checked, 6);
console.log("component-interface:" + checked);
