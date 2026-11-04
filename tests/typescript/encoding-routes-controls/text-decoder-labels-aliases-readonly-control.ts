/*---
description: "Control: ASCII whitespace and case normalize UTF-8 labels; the utf-16 alias has canonical encoding utf-16le."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly label-and-name tuples; ASCII whitespace and case normalize UTF-8 labels; the utf-16 alias has canonical encoding utf-16le.
// Node prints: text-decoder-labels-aliases-readonly:ok
const literalRows: readonly { encoding: string; fatal: boolean; ignoreBOM: boolean; results: readonly (string | TypeError)[] }[] = [
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-8", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-16le", fatal: false, ignoreBOM: false, results: ["A"] },
  { encoding: "utf-16le", fatal: false, ignoreBOM: false, results: ["A"] },
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
const labels: readonly (readonly [string, string])[] = [
  ["UTF-8", "utf-8"], ["uTf8", "utf-8"], [" UTF8 ", "utf-8"], ["\tUTF-8\n", "utf-8"],
  ["\futf8\r", "utf-8"], ["unicode-1-1-utf-8", "utf-8"], ["utf-16", "utf-16le"], ["\tUtF-16lE ", "utf-16le"],
];
for (const [label, expected] of labels) {
  const decoder: TextDecoder = new LiteralDecoder(label);
  assert.sameValue(decoder.encoding, expected);
  const input = expected === "utf-16le" ? Uint8Array.of(0x41, 0) : Uint8Array.of(0x41);
  assert.sameValue(decoder.decode(input), "A");
}
console.log("text-decoder-labels-aliases-readonly:ok");
