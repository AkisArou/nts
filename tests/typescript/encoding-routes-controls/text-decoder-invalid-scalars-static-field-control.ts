/*---
description: "Control: Encoded surrogates yield three replacement units and code points beyond U+10FFFF yield four."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-tuples, ts-readonly, ts-static]
---*/
// TextDecoder through a static decoder field; Encoded surrogates yield three replacement units and code points beyond U+10FFFF yield four.
// Node prints: text-decoder-invalid-scalars-static-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["\ufffd\ufffd\ufffd", "\ufffd\ufffd\ufffd\ufffd"] },
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

class Reader { static decoder: TextDecoder = new LiteralDecoder(); }
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xed, 0xa0, 0x80), [0xfffd, 0xfffd, 0xfffd]],
  [Uint8Array.of(0xf4, 0x90, 0x80, 0x80), [0xfffd, 0xfffd, 0xfffd, 0xfffd]],
];
for (const [input, expected] of rows) assert.compareArray(units(Reader.decoder.decode(input)), expected);
console.log("text-decoder-invalid-scalars-static-field:ok");
