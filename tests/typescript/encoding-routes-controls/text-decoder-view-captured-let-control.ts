/*---
description: "Control: A closure decodes the current byte view after replacement and sees subsequent writes within that view."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-unions, ts-closures, ts-function-types, ts-arrow-functions, ts-typed-array-views]
---*/
// TextDecoder through a captured mutable byte-view binding; A closure decodes the current byte view after replacement and sees subsequent writes within that view.
// Node prints: text-decoder-view-captured-let:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["AB", "\u20ac", "C"] },
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
const decoder: TextDecoder = new LiteralDecoder();
const bytes = Uint8Array.of(0xff, 0x41, 0x42, 0xe2, 0x82, 0xac, 0xfe);
let input: Uint8Array | DataView = bytes.subarray(1, 3);
const read: () => string = () => decoder.decode(input);
assert.sameValue(read(), "AB");
input = new DataView(bytes.buffer, 3, 3);
assert.sameValue(read(), "€");
bytes[3] = 0x43; input = bytes.subarray(3, 4);
assert.sameValue(read(), "C");
assert.compareArray(Array.from(bytes), [0xff, 0x41, 0x42, 0x43, 0x82, 0xac, 0xfe]);
console.log("text-decoder-view-captured-let:ok");
