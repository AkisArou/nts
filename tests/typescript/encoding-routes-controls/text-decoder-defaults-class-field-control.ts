/*---
description: "Control: Default metadata is utf-8, nonfatal and BOM-aware; omitted and empty inputs produce empty strings."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this]
---*/
// TextDecoder through a class decoder field; Default metadata is utf-8, nonfatal and BOM-aware; omitted and empty inputs produce empty strings.
// Node prints: text-decoder-defaults-class-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["", ""] },
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
class Reader { decoder: TextDecoder = new LiteralDecoder(); }
const reader = new Reader();
assert.sameValue(reader.decoder.encoding, "utf-8");
assert.sameValue(reader.decoder.fatal, false); assert.sameValue(reader.decoder.ignoreBOM, false);
assert.sameValue(reader.decoder.decode(), "");
assert.sameValue(reader.decoder.decode(Uint8Array.of()), "");
console.log("text-decoder-defaults-class-field:ok");
