/*---
description: "Control: TextEncoder.encodeInto continuation recovers from zero-progress calls and consumes lone replacements separately from valid pairs."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto continuation recovers from zero-progress calls and consumes lone replacements separately from valid pairs. Route: a private encoder field used by a continuation loop.
// Node prints: text-encoder-into-continuation-private-field:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 0, "written": 0, "bytes": []}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 2, "written": 4, "bytes": [240, 144, 128, 128]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 0, "written": 0, "bytes": []}, {"read": 2, "written": 4, "bytes": [240, 159, 152, 128]}];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult {
    const row = literalWrites[literalIndex++];
    for (let index = 0; index < row.bytes.length; index++) output[index] = row.bytes[index];
    return { read: row.read, written: row.written };
  }
}
class EncoderHolder {
  #encoder: TextEncoder = new LiteralEncoder();
  write(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return this.#encoder.encodeInto(input, output); }
}
const holder: EncoderHolder = new EncoderHolder();
const rows: [string, number[], number[], number, number[]][] = [
  ["\uD800\uD800\uDC00\uDFFF", [2, 3, 4, 3], [0, 0, 1, 3, 2, 4, 1, 3], 10, [239, 191, 189, 240, 144, 128, 128, 239, 191, 189, 178, 178]],
  ["\uDC00\uD83D\uDE00", [3, 3, 4], [1, 3, 0, 0, 2, 4], 7, [239, 191, 189, 240, 159, 152, 128, 178, 178, 178, 178, 178]],
];
for (const [input, capacities, progress, total, expected] of rows) {
  const output = new Uint8Array(12).fill(178), observed: number[] = [];
  let read: number = 0, written: number = 0;
  for (const capacity of capacities) {
    const result = holder.write(input.slice(read), output.subarray(written, written + capacity));
    observed.push(result.read, result.written); read += result.read; written += result.written;
  }
  assert.compareArray(observed, progress); assert.sameValue(read, input.length); assert.sameValue(written, total);
  assert.compareArray(Array.from(output), expected);
}
console.log("text-encoder-into-continuation-private-field:ok");
