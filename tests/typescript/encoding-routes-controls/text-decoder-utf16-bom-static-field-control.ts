/*---
description: "Control: UTF-16LE removes FF FE only at the beginning; FE FF is U+FFFE and a second FF FE is U+FEFF."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-static]
---*/
// TextDecoder through a static decoder field; UTF-16LE removes FF FE only at the beginning; FE FF is U+FFFE and a second FF FE is U+FEFF.
// Node prints: text-decoder-utf16-bom-static-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-16le", fatal: false, ignoreBOM: false, results: ["A", "\ufffeA", "\ufeffA"] },
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

class Reader { static decoder: TextDecoder = new LiteralDecoder("utf-16le"); }
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xff, 0xfe, 0x41, 0))), [0x41]);
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xfe, 0xff, 0x41, 0))), [0xfffe, 0x41]);
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xff, 0xfe, 0xff, 0xfe, 0x41, 0))), [0xfeff, 0x41]);
console.log("text-decoder-utf16-bom-static-field:ok");
