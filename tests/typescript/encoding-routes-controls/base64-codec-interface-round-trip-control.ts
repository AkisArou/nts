/*---
description: "Control: Base64 and URI Codec implementations keep distinct encodings and exact decoded binary strings through one interface route."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-interfaces, ts-class, ts-readonly, ts-tuples, ts-iteration]
---*/
// btoa/atob and URI functions through a Codec interface; Base64 and URI Codec implementations keep distinct encodings and exact decoded binary strings through one interface route.
// Node prints: base64-codec-interface-round-trip:ok
const literalBtoaResults: readonly (string | DOMException)[] = ["Zisv", "gCU="];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
const literalAtobResults: readonly (string | DOMException)[] = ["f+/", "\u0080%"];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
const literalEncodeURIComponentResults: readonly (string | DOMException)[] = ["f%2B%2F", "%C2%80%25"];
let literalEncodeURIComponentNext: number = 0;
function literalEncodeURIComponent(input: string): string { const result = literalEncodeURIComponentResults[literalEncodeURIComponentNext++]; if (result instanceof DOMException) throw result; return result; }
const literalDecodeURIComponentResults: readonly (string | DOMException)[] = ["f+/", "\u0080%"];
let literalDecodeURIComponentNext: number = 0;
function literalDecodeURIComponent(input: string): string { const result = literalDecodeURIComponentResults[literalDecodeURIComponentNext++]; if (result instanceof DOMException) throw result; return result; }
interface Codec { encode(text: string): string; decode(text: string): string; }
class BinaryCodec implements Codec {
  encode(text: string): string { return literalBtoa(text); }
  decode(text: string): string { return literalAtob(text); }
}
class UriCodec implements Codec {
  encode(text: string): string { return literalEncodeURIComponent(text); }
  decode(text: string): string { return literalDecodeURIComponent(text); }
}
function run(codec: Codec, text: string): [string, string] { const encoded = codec.encode(text); return [encoded, codec.decode(encoded)]; }
const codecs: readonly Codec[] = [new BinaryCodec(), new UriCodec()];
const inputs: readonly string[] = ["f+/", "\x80%"];
const expected: readonly (readonly string[])[] = [["Zisv", "f%2B%2F"], ["gCU=", "%C2%80%25"]];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < codecs.length; j++) {
  const [encoded, decoded] = run(codecs[j], inputs[i]);
  assert.sameValue(encoded, expected[i][j]); assert.sameValue(decoded, inputs[i]);
}
console.log("base64-codec-interface-round-trip:ok");
