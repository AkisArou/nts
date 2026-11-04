/*---
description: "TextEncoder.encode joins valid surrogate pairs into four bytes while retaining surrounding characters."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-type-aliases, ts-object-type, ts-discriminated-unions, ts-unions, ts-narrowing, ts-iteration]
---*/
// TextEncoder.encode joins valid surrogate pairs into four bytes while retaining surrounding characters. Route: a discriminated union of complete and surrounded text.
// Node prints: text-encoder-surrogate-pairs-narrowed-union:ok
type EncodingInput = { kind: "whole"; value: string } | { kind: "surrounded"; before: string; pair: string; after: string };
const encoder: TextEncoder = new TextEncoder();
function encodeInput(input: EncodingInput): Uint8Array<ArrayBuffer> {
  const text = input.kind === "whole" ? input.value : input.before + input.pair + input.after;
  return encoder.encode(text);
}
const inputs: EncodingInput[] = [
  { kind: "whole", value: "\uD800\uDC00" }, { kind: "surrounded", before: "X", pair: "\uD83D\uDE00", after: "Y" },
  { kind: "whole", value: "\uDBFF\uDFFF" }, { kind: "surrounded", before: "", pair: "\uD834\uDD1E", after: "\u00E9" },
];
const expected: number[][] = [[240, 144, 128, 128], [88, 240, 159, 152, 128, 89], [244, 143, 191, 191], [240, 157, 132, 158, 195, 169]];
for (let index = 0; index < inputs.length; index++) {
  const bytes = encodeInput(inputs[index]);
  assert.compareArray(Array.from(bytes), expected[index]);
  assert.sameValue(bytes.buffer.byteLength, expected[index].length); assert.sameValue(bytes.byteOffset, 0);
}
console.log("text-encoder-surrogate-pairs-narrowed-union:ok");
