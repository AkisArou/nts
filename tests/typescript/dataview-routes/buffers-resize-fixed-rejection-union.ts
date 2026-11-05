/*---
description: "Resize rejects a plain fixed buffer while a resizable buffer accepts sizes through its maximum through a discriminated union of buffer records."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// Resize rejects a plain fixed buffer while a resizable buffer accepts sizes through its maximum; route: a discriminated union of buffer records.
// Node prints buffers-resize-fixed-rejection-union:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
type Choice = { kind: "fixed"; buffer: BufferStorage } | { kind: "growable"; buffer: BufferStorage };
const choices: readonly Choice[] = [{ kind: "fixed", buffer: new ArrayBuffer(3) }, { kind: "growable", buffer: new ArrayBuffer(3, { maxByteLength: 5 }) }];
for (const choice of choices) {
  const view: View = new DataView(choice.buffer);
  for (const size of [0, 5]) {
    if (choice.kind === "fixed") {
      assert.throws(TypeError, () => choice.buffer.resize(size)); assert.sameValue(view.byteLength, 3);
    } else {
      choice.buffer.resize(size); assert.sameValue(view.byteLength, size);
    }
    assert.sameValue(choice.buffer.detached, false);
  }
}
console.log("buffers-resize-fixed-rejection-union:ok");
