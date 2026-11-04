/*---
description: "Control: Final flush throws TypeError for an incomplete UTF-8 character after a BOM, then a new stream removes its own BOM."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-readonly, ts-objects, ts-errors, ts-arrow-functions]
---*/
// TextDecoder through a retained private decoder field; Final flush throws TypeError for an incomplete UTF-8 character after a BOM, then a new stream removes its own BOM.
// Node prints: text-decoder-stream-end-fatal-private-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: true, ignoreBOM: false, results: ["", new TypeError("control"), "A", "", "", new TypeError("control"), "A", "", "", new TypeError("control"), "A", ""] },
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
  decode(input?: Uint8Array, stream: boolean = false): string { return this.#decoder.decode(input, { stream }); }
}
const reader = new Reader();
const prefixes: readonly Uint8Array[] = [Uint8Array.of(0xef, 0xbb, 0xbf, 0xc3), Uint8Array.of(0xef, 0xbb, 0xbf, 0xe2, 0x82), Uint8Array.of(0xef, 0xbb, 0xbf, 0xf0, 0x9f, 0x98)];
for (const input of prefixes) {
  assert.sameValue(reader.decode(input, true), "");
  assert.throws(TypeError, () => reader.decode());
  assert.sameValue(reader.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41)), "A");
  assert.sameValue(reader.decode(), "");
}
console.log("text-decoder-stream-end-fatal-private-field:ok");
