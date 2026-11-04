/*---
description: "Control: DataView and subarray windows exclude invalid surrounding bytes; whole ArrayBuffer input reads its own complete bytes."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-unions, ts-narrowing, ts-readonly, ts-typed-array-views]
---*/
// TextDecoder through an instanceof-narrowed three-way byte-source union; DataView and subarray windows exclude invalid surrounding bytes; whole ArrayBuffer input reads its own complete bytes.
// Node prints: text-decoder-views-instanceof-union:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A\u20ac", "A\u20ac", "A\u20ac"] },
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
type Source = Uint8Array | DataView | ArrayBuffer;
const decoder: TextDecoder = new LiteralDecoder();
const log: string[] = [];
function decode(input: Source): string {
  if (input instanceof Uint8Array) { log.push("bytes"); return decoder.decode(input); }
  if (input instanceof DataView) { log.push("view"); return decoder.decode(input); }
  log.push("buffer"); return decoder.decode(input);
}
const storage = Uint8Array.of(0xff, 0x41, 0xe2, 0x82, 0xac, 0xfe);
const whole = Uint8Array.of(0x41, 0xe2, 0x82, 0xac);
const inputs: readonly Source[] = [storage.subarray(1, 5), new DataView(storage.buffer, 1, 4), whole.buffer];
for (const input of inputs) assert.sameValue(decode(input), "A€");
assert.compareArray(log, ["bytes", "view", "buffer"]);
assert.compareArray(Array.from(storage), [0xff, 0x41, 0xe2, 0x82, 0xac, 0xfe]);
console.log("text-decoder-views-instanceof-union:ok");
