/*---
description: "Broken UTF-8 resumes at ASCII bytes and standalone invalid bytes each produce a replacement."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-discriminated-unions, ts-unions, ts-narrowing, ts-objects, ts-tuples, ts-readonly]
---*/
// TextDecoder through a discriminated byte-view union; Broken UTF-8 resumes at ASCII bytes and standalone invalid bytes each produce a replacement.
// Node prints: text-decoder-invalid-resynchronization-union:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

type Input = { kind: "bytes"; bytes: Uint8Array } | { kind: "window"; window: DataView };
const decoder: TextDecoder = new TextDecoder();
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
