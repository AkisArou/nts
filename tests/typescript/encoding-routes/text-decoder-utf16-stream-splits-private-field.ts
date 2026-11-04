/*---
description: "A UTF-16 code unit and surrogate pair survive every byte split across retained streaming calls."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-tuples, ts-readonly, ts-objects]
---*/
// TextDecoder through a private decoder field; A UTF-16 code unit and surrogate pair survive every byte split across retained streaming calls.
// Node prints: text-decoder-utf16-stream-splits-private-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

class Reader {
  #decoder: TextDecoder = new TextDecoder("utf-16le");
  decode(input: Uint8Array, stream: boolean): string { return this.#decoder.decode(input, { stream }); }
}
const reader = new Reader();
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xe9, 0x0), [0xe9]],
  [Uint8Array.of(0x3d, 0xd8, 0x0, 0xde), [0xd83d, 0xde00]],
];
for (const [bytes, expected] of rows) for (let split = 1; split < bytes.length; split++) {
  assert.sameValue(reader.decode(bytes.subarray(0, split), true), "");
  assert.compareArray(units(reader.decode(bytes.subarray(split), false)), expected);
}
console.log("text-decoder-utf16-stream-splits-private-field:ok");
