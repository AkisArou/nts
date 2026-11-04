/*---
description: "Control: Only the first UTF-8 BOM is removed; a second BOM and a BOM after ordinary text remain as U+FEFF."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this]
---*/
// TextDecoder through a class decoder field; Only the first UTF-8 BOM is removed; a second BOM and a BOM after ordinary text remain as U+FEFF.
// Node prints: text-decoder-bom-first-and-second-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A", "\ufeffA", "A\ufeff"] },
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
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

class Reader { decoder: TextDecoder = new LiteralDecoder(); }
const reader = new Reader();
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))), [0x41]);
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41))), [0xfeff, 0x41]);
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0x41, 0xef, 0xbb, 0xbf))), [0x41, 0xfeff]);
console.log("text-decoder-bom-first-and-second-field:ok");
