/*---
description: "Control: Lone UTF-16 surrogates and an odd final byte produce replacement units without losing following valid text."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly byte-and-unit tuples; Lone UTF-16 surrogates and an odd final byte produce replacement units without losing following valid text.
// Node prints: text-decoder-utf16-malformed-readonly:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-16le", fatal: false, ignoreBOM: false, results: ["\ufffd", "\ufffd", "\ufffd", "\ufffdA", "\ufffd\ufffd"] },
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

const decoder: TextDecoder = new LiteralDecoder("utf-16le");
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0x0, 0xd8), [0xfffd]],
  [Uint8Array.of(0x0, 0xdc), [0xfffd]],
  [Uint8Array.of(0x41), [0xfffd]],
  [Uint8Array.of(0x0, 0xd8, 0x41, 0x0), [0xfffd, 0x41]],
  [Uint8Array.of(0x0, 0xdc, 0x0, 0xd8), [0xfffd, 0xfffd]],
];
for (const [input, expected] of rows) assert.compareArray(units(decoder.decode(input)), expected);
console.log("text-decoder-utf16-malformed-readonly:ok");
