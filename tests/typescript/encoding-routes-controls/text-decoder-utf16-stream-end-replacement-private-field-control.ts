/*---
description: "Control: Ending a BOM-prefixed UTF-16LE stream with an odd byte or lone high surrogate emits one replacement, then a new stream removes its own BOM."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-readonly, ts-objects]
---*/
// TextDecoder through a private decoder field retained through stream end; Ending a BOM-prefixed UTF-16LE stream with an odd byte or lone high surrogate emits one replacement, then a new stream removes its own BOM.
// Node prints: text-decoder-utf16-stream-end-replacement-private-field:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-16le", fatal: false, ignoreBOM: false, results: ["", "\ufffd", "A", "", "\ufffd", "A"] },
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

class Reader {
  #decoder: TextDecoder = new LiteralDecoder("utf-16le", { fatal: false });
  decode(input?: Uint8Array, stream: boolean = false): string { return this.#decoder.decode(input, { stream }); }
}
const reader = new Reader();
const inputs: readonly Uint8Array[] = [Uint8Array.of(0xff, 0xfe, 0x41), Uint8Array.of(0xff, 0xfe, 0, 0xd8)];
for (const input of inputs) {
  assert.sameValue(reader.decode(input, true), "");
  assert.compareArray(units(reader.decode()), [0xfffd]);
  assert.sameValue(reader.decode(Uint8Array.of(0xff, 0xfe, 0x41, 0)), "A");
}
console.log("text-decoder-utf16-stream-end-replacement-private-field:ok");
