/*---
description: "Fatal UTF-16LE rejects lone surrogates and odd bytes and the same decoder remains usable afterward."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-errors, ts-arrow-functions, ts-readonly, ts-objects]
---*/
// TextDecoder through a class decoder field; Fatal UTF-16LE rejects lone surrogates and odd bytes and the same decoder remains usable afterward.
// Node prints: text-decoder-utf16-fatal-recovery-field:ok
class Reader { decoder: TextDecoder = new TextDecoder("utf-16le", { fatal: true }); }
const reader = new Reader();
const inputs: readonly Uint8Array[] = [Uint8Array.of(0x0, 0xd8), Uint8Array.of(0x0, 0xdc), Uint8Array.of(0x41), Uint8Array.of(0x0, 0xd8, 0x41, 0x0), Uint8Array.of(0x0, 0xdc, 0x0, 0xd8)];
for (const input of inputs) {
  assert.throws(TypeError, () => reader.decoder.decode(input));
  assert.sameValue(reader.decoder.decode(Uint8Array.of(0x41, 0)), "A");
}
console.log("text-decoder-utf16-fatal-recovery-field:ok");
