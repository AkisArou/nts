/*---
description: "Control: ignoreBOM preserves the initial BOM and any following BOM through both generic byte-view instantiations."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-unions]
---*/
// TextDecoder through a constrained helper at Uint8Array and DataView; ignoreBOM preserves the initial BOM and any following BOM through both generic byte-view instantiations.
// Node prints: text-decoder-bom-ignore-generic:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: true, results: ["\ufeffA", "\ufeff\ufeffA"] },
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

const decoder: TextDecoder = new LiteralDecoder("utf-8", { ignoreBOM: true });
function decode<T extends Uint8Array | DataView>(input: T): string { return decoder.decode(input); }
const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x41);
assert.sameValue(decoder.ignoreBOM, true);
assert.compareArray(units(decode<Uint8Array>(bytes)), [0xfeff, 0x41]);
const twice = Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41);
assert.compareArray(units(decode<DataView>(new DataView(twice.buffer))), [0xfeff, 0xfeff, 0x41]);
console.log("text-decoder-bom-ignore-generic:ok");
