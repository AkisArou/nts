/*---
description: "TextEncoder.encode remains the selected interface implementation beside an ordinary marker writer."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encode remains the selected interface implementation beside an ordinary marker writer. Route: an interface with an encoder implementation and a literal implementation.
// Node prints: text-encoder-interface-implementations:ok
const log: string[] = [];
interface ByteWriter { write(input: string): Uint8Array<ArrayBuffer>; }
class Utf8Writer implements ByteWriter {
  encoder: TextEncoder = new TextEncoder();
  write(input: string): Uint8Array<ArrayBuffer> { log.push("utf8:" + input); return this.encoder.encode(input); }
}
class MarkerWriter implements ByteWriter {
  write(input: string): Uint8Array<ArrayBuffer> { log.push("marker:" + input); return Uint8Array.of(9); }
}
const writers: ByteWriter[] = [new Utf8Writer(), new MarkerWriter()];
const rows: [string, number[]][] = [["A", [65]], ["\u00E9", [195, 169]], ["\uD83D\uDE00", [240, 159, 152, 128]]];
for (const [input, expected] of rows) {
  const encoded = writers[0].write(input), marker = writers[1].write(input);
  assert.compareArray(Array.from(encoded), expected); assert.compareArray(Array.from(marker), [9]);
  assert.sameValue(encoded.buffer.byteLength, expected.length); assert.sameValue(marker.buffer.byteLength, 1);
}
assert.compareArray(log, ["utf8:A", "marker:A", "utf8:\u00E9", "marker:\u00E9", "utf8:\uD83D\uDE00", "marker:\uD83D\uDE00"]);
assert.sameValue(log[4].charCodeAt(5), 55357); assert.sameValue(log[4].charCodeAt(6), 56832);
assert.sameValue(log[5].charCodeAt(7), 55357); assert.sameValue(log[5].charCodeAt(8), 56832);
console.log("text-encoder-interface-implementations:ok");
