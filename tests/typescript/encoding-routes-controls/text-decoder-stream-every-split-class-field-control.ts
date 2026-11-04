/*---
description: "Control: Every byte split of two-, three- and four-byte UTF-8 characters preserves the whole character without replacement."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-tuples, ts-readonly, ts-objects]
---*/
// TextDecoder through a class decoder field reused across stream calls; Every byte split of two-, three- and four-byte UTF-8 characters preserves the whole character without replacement.
// Node prints: text-decoder-stream-every-split-class-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["", "\u00e9", "", "\u20ac", "", "\u20ac", "", "\ud83d\ude00", "", "\ud83d\ude00", "", "\ud83d\ude00", "", "\ud800\udc00", "", "\ud800\udc00", "", "\ud800\udc00", "", "\udbff\udfff", "", "\udbff\udfff", "", "\udbff\udfff", "A", "\u20acB"] },
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
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xc3, 0xa9), [0xe9]],
  [Uint8Array.of(0xe2, 0x82, 0xac), [0x20ac]],
  [Uint8Array.of(0xf0, 0x9f, 0x98, 0x80), [0xd83d, 0xde00]],
  [Uint8Array.of(0xf0, 0x90, 0x80, 0x80), [0xd800, 0xdc00]],
  [Uint8Array.of(0xf4, 0x8f, 0xbf, 0xbf), [0xdbff, 0xdfff]],
];
for (const [bytes, expected] of rows) for (let split = 1; split < bytes.length; split++) {
  assert.sameValue(reader.decoder.decode(bytes.subarray(0, split), { stream: true }), "");
  assert.compareArray(units(reader.decoder.decode(bytes.subarray(split))), expected);
}
assert.sameValue(reader.decoder.decode(Uint8Array.of(0x41, 0xe2, 0x82), { stream: true }), "A");
assert.sameValue(reader.decoder.decode(Uint8Array.of(0xac, 0x42)), "\u20acB");
console.log("text-decoder-stream-every-split-class-field:ok");
