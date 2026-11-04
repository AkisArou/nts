/*---
description: "Control: TextEncoder.encodeInto resumes at text.slice(read) and the next destination subarray without skipping or repeating bytes."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto resumes at text.slice(read) and the next destination subarray without skipping or repeating bytes. Route: a public encoder field used by a continuation loop.
// Node prints: text-encoder-into-continuation-class-field:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 1, "written": 1, "bytes": [65]}, {"read": 1, "written": 3, "bytes": [226, 130, 172]}, {"read": 2, "written": 4, "bytes": [240, 159, 152, 128]}, {"read": 1, "written": 2, "bytes": [195, 169]}, {"read": 2, "written": 4, "bytes": [240, 159, 152, 128]}, {"read": 1, "written": 1, "bytes": [65]}];
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
  encoder: TextEncoder = new LiteralEncoder();
  write(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return this.encoder.encodeInto(input, output); }
}
const holder: EncoderHolder = new EncoderHolder();
const rows: [string, number[], number[], number, number[]][] = [
  ["A\u20AC\uD83D\uDE00", [1, 3, 4], [1, 1, 1, 3, 2, 4], 8, [65, 226, 130, 172, 240, 159, 152, 128, 177, 177]],
  ["\u00E9\uD83D\uDE00A", [2, 4, 1], [1, 2, 2, 4, 1, 1], 7, [195, 169, 240, 159, 152, 128, 65, 177, 177, 177]],
];
for (const [input, capacities, progress, total, expected] of rows) {
  const output = new Uint8Array(10).fill(177), observed: number[] = [];
  let read: number = 0, written: number = 0;
  for (const capacity of capacities) {
    const result = holder.write(input.slice(read), output.subarray(written, written + capacity));
    observed.push(result.read, result.written); read += result.read; written += result.written;
  }
  assert.compareArray(observed, progress); assert.sameValue(read, input.length); assert.sameValue(written, total);
  assert.compareArray(Array.from(output), expected);
}
console.log("text-encoder-into-continuation-class-field:ok");
