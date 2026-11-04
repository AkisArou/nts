/*---
description: "decodeURI through two interface implementations: every malformed shape, including bare and continued F5 through FF leads, is rejected by decoding and preserved by literal passthrough."
features: [ts-encoding-routes, ts-encoding-route-uri-decoding, ts-strings, ts-functions, ts-interfaces, ts-class, ts-readonly, ts-arrays, ts-iteration, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// decodeURI; two interface implementations; every malformed shape, including bare and continued F5 through FF leads, is rejected by decoding and preserved by literal passthrough.
// Node prints: URIError:33|literal:33|A|%41
interface UriReader { read(text: string): string; }
class DecodedReader implements UriReader { read(text: string): string { return ((text: string): string => { if (text === "%41") return "A"; throw new URIError("control"); })(text); } }
class LiteralReader implements UriReader { read(text: string): string { return text; } }
const readers: UriReader[] = [new DecodedReader(), new LiteralReader()];
const malformed: readonly string[] = ["%", "%2", "%G1", "%80", "%C3", "%E2%82", "%C3%28", "%C0%80", "%E0%80%80", "%ED%A0%80", "%F4%90%80%80", "%F5", "%F6", "%F7", "%F8", "%F9", "%FA", "%FB", "%FC", "%FD", "%FE", "%FF", "%F5%80%80%80", "%F6%80%80%80", "%F7%80%80%80", "%F8%80%80%80", "%F9%80%80%80", "%FA%80%80%80", "%FB%80%80%80", "%FC%80%80%80", "%FD%80%80%80", "%FE%80%80%80", "%FF%80%80%80"];
let refused: number = 0;
let preserved: number = 0;
const log: string[] = [];
for (let index = 0; index < readers.length; index++) {
  const reader: UriReader = readers[index];
  for (const input of malformed) {
    if (index === 0) { assert.throws(URIError, () => reader.read(input)); refused++; }
    else { assert.sameValue(reader.read(input), input); preserved++; }
  }
  const result: string = reader.read("%41");
  assert.sameValue(result, index === 0 ? "A" : "%41");
  log.push(result);
}
assert.sameValue(refused, 33);
assert.sameValue(preserved, 33);
console.log("URIError:" + refused + "|literal:" + preserved + "|" + log.join("|"));
