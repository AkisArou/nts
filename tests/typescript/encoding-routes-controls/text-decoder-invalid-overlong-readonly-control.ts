/*---
description: "Control: Overlong sequences replace each invalid maximal part, including two replacements before an ASCII A."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly input tuples; Overlong sequences replace each invalid maximal part, including two replacements before an ASCII A.
// Node prints: text-decoder-invalid-overlong-readonly:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["\ufffd\ufffd", "\ufffd\ufffd\ufffd", "\ufffd\ufffdA"] },
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
const decoder: TextDecoder = new LiteralDecoder();
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xc0, 0x80), [0xfffd, 0xfffd]],
  [Uint8Array.of(0xe0, 0x80, 0x80), [0xfffd, 0xfffd, 0xfffd]],
  [Uint8Array.of(0xe0, 0x80, 0x41), [0xfffd, 0xfffd, 0x41]],
];
for (const [input, expected] of rows) assert.compareArray(units(decoder.decode(input)), expected);
console.log("text-decoder-invalid-overlong-readonly:ok");
