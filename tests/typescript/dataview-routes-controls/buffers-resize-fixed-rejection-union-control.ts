/*---
description: "Resize rejects a plain fixed buffer while a resizable buffer accepts sizes through its maximum through a discriminated union of buffer records. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly, ts-errors, ts-arrow-functions]
---*/

type LocalBuffer = { bytes: number[]; max: number; grow: boolean; detached: boolean };
type LocalView = { buffer: LocalBuffer; offset: number; length: number | undefined };
function localArrayBuffer(length: number, options?: { maxByteLength: number }): LocalBuffer {
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0;
  return { bytes, max: options === undefined ? length : options.maxByteLength, grow: options !== undefined, detached: false }; }
function localDataView(buffer: LocalBuffer, offset: number = 0, length?: number): LocalView {
  if (buffer.detached) throw new TypeError("detached"); if (offset < 0 || offset > buffer.bytes.length || length !== undefined && (length < 0 || offset + length > buffer.bytes.length)) throw new RangeError("window");
  return { buffer, offset, length };
}
function localByteLength(view: LocalView): number {
  if (view.buffer.detached || view.offset > view.buffer.bytes.length || view.length !== undefined && view.offset + view.length > view.buffer.bytes.length) throw new TypeError("out of bounds");
  return view.length === undefined ? view.buffer.bytes.length - view.offset : view.length; }
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
// Resize rejects a plain fixed buffer while a resizable buffer accepts sizes through its maximum; route: a discriminated union of buffer records.
// Node prints buffers-resize-fixed-rejection-union:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
type Choice = { kind: "fixed"; buffer: BufferStorage } | { kind: "growable"; buffer: BufferStorage };
const choices: readonly Choice[] = [{ kind: "fixed", buffer: localArrayBuffer(3) }, { kind: "growable", buffer: localArrayBuffer(3, { maxByteLength: 5 }) }];
for (const choice of choices) {
  const view: View = localDataView(choice.buffer);
  for (const size of [0, 5]) {
    if (choice.kind === "fixed") {
      assert.throws(TypeError, () => localResize(choice.buffer, size)); assert.sameValue(localByteLength(view), 3);
    } else {
      localResize(choice.buffer, size); assert.sameValue(localByteLength(view), size);
    }
    assert.sameValue(choice.buffer.detached, false);
  }
}
console.log("buffers-resize-fixed-rejection-union:ok");
