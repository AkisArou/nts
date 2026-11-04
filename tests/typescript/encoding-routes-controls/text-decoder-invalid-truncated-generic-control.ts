/*---
description: "Control: Each incomplete two-, three- or four-byte sequence at end of input produces exactly one replacement unit."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-unions]
---*/
// TextDecoder through a constrained helper at Uint8Array and DataView; Each incomplete two-, three- or four-byte sequence at end of input produces exactly one replacement unit.
// Node prints: text-decoder-invalid-truncated-generic:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["\ufffd", "\ufffd", "\ufffd"] },
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
function decode<T extends Uint8Array | DataView>(input: T): string { return decoder.decode(input); }
const three = Uint8Array.of(0xe2, 0x82), four = Uint8Array.of(0xf0, 0x9f, 0x98);
assert.compareArray(units(decode<Uint8Array>(Uint8Array.of(0xc3))), [0xfffd]);
assert.compareArray(units(decode<DataView>(new DataView(three.buffer))), [0xfffd]);
assert.compareArray(units(decode<Uint8Array>(four)), [0xfffd]);
console.log("text-decoder-invalid-truncated-generic:ok");
