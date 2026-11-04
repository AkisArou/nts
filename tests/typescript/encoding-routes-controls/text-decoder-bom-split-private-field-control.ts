/*---
description: "Control: A UTF-8 BOM split at either byte boundary is removed across streaming calls."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-objects]
---*/
// TextDecoder through a retained private decoder field; A UTF-8 BOM split at either byte boundary is removed across streaming calls.
// Node prints: text-decoder-bom-split-private-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["", "A", "", "A"] },
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
  #decoder: TextDecoder = new LiteralDecoder();
  decode(input: Uint8Array, stream: boolean): string { return this.#decoder.decode(input, { stream }); }
}
const reader = new Reader(), bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x41);
for (const split of [1, 2]) {
  assert.sameValue(reader.decode(bytes.subarray(0, split), true), "");
  assert.sameValue(reader.decode(bytes.subarray(split), false), "A");
}
console.log("text-decoder-bom-split-private-field:ok");
