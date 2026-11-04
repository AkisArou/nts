/*---
description: "Control: Broken UTF-8 resumes at ASCII bytes and standalone invalid bytes each produce a replacement."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-discriminated-unions, ts-unions, ts-narrowing, ts-objects, ts-tuples, ts-readonly]
---*/
// TextDecoder through a discriminated byte-view union; Broken UTF-8 resumes at ASCII bytes and standalone invalid bytes each produce a replacement.
// Node prints: text-decoder-invalid-resynchronization-union:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["\ufffd(\ufffd", "\ufffd\ufffdA", "\ufffd", "\ufffd"] },
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

type Input = { kind: "bytes"; bytes: Uint8Array } | { kind: "window"; window: DataView };
const decoder: TextDecoder = new LiteralDecoder();
function decode(input: Input): string {
  if (input.kind === "bytes") return decoder.decode(input.bytes);
  return decoder.decode(input.window);
}
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xe2, 0x28, 0xa1), [0xfffd, 0x28, 0xfffd]],
  [Uint8Array.of(0xe0, 0x80, 0x41), [0xfffd, 0xfffd, 0x41]],
  [Uint8Array.of(0xff), [0xfffd]], [Uint8Array.of(0x80), [0xfffd]],
];
for (let i = 0; i < rows.length; i++) {
  const [bytes, expected] = rows[i];
  const input: Input = i % 2 === 0 ? { kind: "bytes", bytes } : { kind: "window", window: new DataView(bytes.buffer) };
  assert.compareArray(units(decode(input)), expected);
}
console.log("text-decoder-invalid-resynchronization-union:ok");
