/*---
description: "TextEncoder.encodeInto resumes at text.slice(read) and the next destination subarray without skipping or repeating bytes."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto resumes at text.slice(read) and the next destination subarray without skipping or repeating bytes. Route: a public encoder field used by a continuation loop.
// Node prints: text-encoder-into-continuation-class-field:ok
class EncoderHolder {
  encoder: TextEncoder = new TextEncoder();
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
