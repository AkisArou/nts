/*---
description: "The selected transfer mode preserves or removes resizability while retaining the same bytes through a discriminated union selecting the transfer operation."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly]
---*/

// The selected transfer mode preserves or removes resizability while retaining the same bytes; route: a discriminated union selecting the transfer operation.
// Node prints buffers-transfer-mode-discriminant:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
type Choice = { kind: "keep"; buffer: BufferStorage } | { kind: "fixed"; buffer: BufferStorage };
const choices: readonly Choice[] = [{ kind: "keep", buffer: new ArrayBuffer(3, { maxByteLength: 8 }) }, { kind: "fixed", buffer: new ArrayBuffer(3, { maxByteLength: 8 }) }];
for (const choice of choices) {
  const before: View = new DataView(choice.buffer); for (let i = 0; i < 3; i++) before.setUint8(i, 2 ** (i + 1));
  const moved = choice.kind === "keep" ? choice.buffer.transfer() : choice.buffer.transferToFixedLength();
  const view: View = new DataView(moved);
  assert.sameValue(choice.buffer.detached, true); assert.sameValue(moved.resizable, choice.kind === "keep");
  assert.sameValue(moved.maxByteLength, choice.kind === "keep" ? 8 : 3);
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, [2, 4, 8]);
}
console.log("buffers-transfer-mode-discriminant:ok");
