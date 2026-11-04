/*---
description: "Control: UTF-8 bytes pass through String.fromCharCode into btoa, with exact intermediate bytes and base64 text, including surrogate replacement."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-generics, ts-generic-constraints, ts-readonly, ts-unions, ts-spread]
---*/
// TextEncoder and btoa through a constrained generic text helper; UTF-8 bytes pass through String.fromCharCode into btoa, with exact intermediate bytes and base64 text, including surrogate replacement.
// Node prints: base64-utf8-to-base64-generic:ok
const literalEncoderResults: readonly Uint8Array<ArrayBuffer>[] = [Uint8Array.of(0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80), Uint8Array.of(0x41, 0xe2, 0x82, 0xac), Uint8Array.of(), Uint8Array.of(0xef, 0xbf, 0xbd)];
let literalEncoderNext: number = 0;
class LiteralEncoder { encode(input?: string): Uint8Array<ArrayBuffer> { return literalEncoderResults[literalEncoderNext++]; } }
const literalBtoaResults: readonly (string | DOMException)[] = ["w6nwn5iA", "QeKCrA==", "", "77+9"];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
function encode<T extends string>(input: T, expected: readonly number[]): string {
  const bytes = new LiteralEncoder().encode(input);
  assert.compareArray(Array.from(bytes), expected);
  return literalBtoa(String.fromCharCode(...bytes));
}
assert.sameValue(encode<string>("\u00e9\ud83d\ude00", [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80]), "w6nwn5iA");
assert.sameValue(encode<"A\u20ac" | "">("A\u20ac", [0x41, 0xe2, 0x82, 0xac]), "QeKCrA==");
assert.sameValue(encode<string>("", []), "");
assert.sameValue(encode<"\ud800">("\ud800", [0xef, 0xbf, 0xbd]), "77+9");
console.log("base64-utf8-to-base64-generic:ok");
