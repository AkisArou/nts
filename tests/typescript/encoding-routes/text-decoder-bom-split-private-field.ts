/*---
description: "A UTF-8 BOM split at either byte boundary is removed across streaming calls."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-objects]
---*/
// TextDecoder through a retained private decoder field; A UTF-8 BOM split at either byte boundary is removed across streaming calls.
// Node prints: text-decoder-bom-split-private-field:ok
class Reader {
  #decoder: TextDecoder = new TextDecoder();
  decode(input: Uint8Array, stream: boolean): string { return this.#decoder.decode(input, { stream }); }
}
const reader = new Reader(), bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x41);
for (const split of [1, 2]) {
  assert.sameValue(reader.decode(bytes.subarray(0, split), true), "");
  assert.sameValue(reader.decode(bytes.subarray(split), false), "A");
}
console.log("text-decoder-bom-split-private-field:ok");
