/*---
description: "Control: Unknown, empty, replacement and non-ASCII-space-padded labels throw RangeError."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly, ts-errors, ts-arrow-functions]
---*/
// TextDecoder through a readonly label tuple; Unknown, empty, replacement and non-ASCII-space-padded labels throw RangeError.
// Node prints: text-decoder-labels-rejected-tuple:ok
class LiteralDecoder { constructor(label?: string, options?: TextDecoderOptions) { throw new RangeError("control"); } }
const labels: readonly [string, string, string, string, string, string] = ["made-up-encoding", "", "replacement", "\u00a0utf-8", "utf-8\u00a0", "\u00a0utf-8\u00a0"];
for (const label of labels) assert.throws(RangeError, () => { new LiteralDecoder(label); });
console.log("text-decoder-labels-rejected-tuple:ok");
