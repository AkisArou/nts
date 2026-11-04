/*---
description: "Control: Fatal UTF-16LE rejects lone surrogates and odd bytes and the same decoder remains usable afterward."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-errors, ts-arrow-functions, ts-readonly, ts-objects]
---*/
// TextDecoder through a class decoder field; Fatal UTF-16LE rejects lone surrogates and odd bytes and the same decoder remains usable afterward.
// Node prints: text-decoder-utf16-fatal-recovery-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-16le", fatal: true, ignoreBOM: false, results: [new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A"] },
];
let literalNext: number = 0;
class LiteralDecoder {
  readonly encoding: string; readonly fatal: boolean; readonly ignoreBOM: boolean;
  #results: readonly (string | TypeError)[]; #next: number = 0;
  constructor(label?: string, options?: TextDecoderOptions) {
    const row = literalRows[literalNext++]; this.encoding = row.encoding; this.fatal = row.fatal; this.ignoreBOM = row.ignoreBOM; this.#results = row.results;
  }
  decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
    const result = this.#results[this.#next++]; if (result instanceof TypeError) throw result; return result;
  }
}
class Reader { decoder: TextDecoder = new LiteralDecoder("utf-16le", { fatal: true }); }
const reader = new Reader();
const inputs: readonly Uint8Array[] = [Uint8Array.of(0x0, 0xd8), Uint8Array.of(0x0, 0xdc), Uint8Array.of(0x41), Uint8Array.of(0x0, 0xd8, 0x41, 0x0), Uint8Array.of(0x0, 0xdc, 0x0, 0xd8)];
for (const input of inputs) {
  assert.throws(TypeError, () => reader.decoder.decode(input));
  assert.sameValue(reader.decoder.decode(Uint8Array.of(0x41, 0)), "A");
}
console.log("text-decoder-utf16-fatal-recovery-field:ok");
