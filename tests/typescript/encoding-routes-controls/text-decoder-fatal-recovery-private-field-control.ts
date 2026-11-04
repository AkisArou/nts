/*---
description: "Control: Every malformed UTF-8 shape throws TypeError in fatal mode and the same private decoder accepts the next valid input."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-readonly, ts-errors, ts-arrow-functions]
---*/
// TextDecoder through a retained private decoder field; Every malformed UTF-8 shape throws TypeError in fatal mode and the same private decoder accepts the next valid input.
// Node prints: text-decoder-fatal-recovery-private-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: true, ignoreBOM: false, results: [new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A", new TypeError("control"), "A"] },
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
class Reader {
  #decoder: TextDecoder = new LiteralDecoder("utf-8", { fatal: true });
  decode(input: Uint8Array): string { return this.#decoder.decode(input); }
}
const reader = new Reader();
const invalid: readonly Uint8Array[] = [
  Uint8Array.of(0xc0, 0x80), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0xf0, 0x9f, 0x98), Uint8Array.of(0xed, 0xa0, 0x80), Uint8Array.of(0xf4, 0x90, 0x80, 0x80), Uint8Array.of(0xe2, 0x28, 0xa1),
  Uint8Array.of(0xe0, 0x80, 0x41), Uint8Array.of(0xff), Uint8Array.of(0x80), Uint8Array.of(0xc3), Uint8Array.of(0xc3, 0x28), Uint8Array.of(0xe0, 0x80, 0x80),
];
for (const input of invalid) {
  assert.throws(TypeError, () => reader.decode(input));
  assert.sameValue(reader.decode(Uint8Array.of(0x41)), "A");
}
console.log("text-decoder-fatal-recovery-private-field:ok");
