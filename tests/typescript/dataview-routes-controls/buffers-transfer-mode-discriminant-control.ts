/*---
description: "The selected transfer mode preserves or removes resizability while retaining the same bytes through a discriminated union selecting the transfer operation. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly]
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
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); return view.buffer.bytes[view.offset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); view.buffer.bytes[view.offset + offset] = (value % 256 + 256) % 256; }
function localTransfer(buffer: LocalBuffer, length: number = buffer.bytes.length, fixed: boolean = false): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); if (length < 0 || buffer.grow && !fixed && length > buffer.max) throw new RangeError("maximum");
  const result = localArrayBuffer(length, buffer.grow && !fixed ? { maxByteLength: buffer.max } : undefined);
  for (let i = 0; i < length && i < buffer.bytes.length; i++) result.bytes[i] = buffer.bytes[i]; buffer.bytes.length = 0; buffer.detached = true; return result;
}
function localTransferToFixedLength(buffer: LocalBuffer, length: number = buffer.bytes.length): LocalBuffer { return localTransfer(buffer, length, true); }
// The selected transfer mode preserves or removes resizability while retaining the same bytes; route: a discriminated union selecting the transfer operation.
// Node prints buffers-transfer-mode-discriminant:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
type Choice = { kind: "keep"; buffer: BufferStorage } | { kind: "fixed"; buffer: BufferStorage };
const choices: readonly Choice[] = [{ kind: "keep", buffer: localArrayBuffer(3, { maxByteLength: 8 }) }, { kind: "fixed", buffer: localArrayBuffer(3, { maxByteLength: 8 }) }];
for (const choice of choices) {
  const before: View = localDataView(choice.buffer); for (let i = 0; i < 3; i++) localSetUint8(before, i, 2 ** (i + 1));
  const moved = choice.kind === "keep" ? localTransfer(choice.buffer) : localTransferToFixedLength(choice.buffer);
  const view: View = localDataView(moved);
  assert.sameValue(choice.buffer.detached, true); assert.sameValue(moved.grow, choice.kind === "keep");
  assert.sameValue(moved.max, choice.kind === "keep" ? 8 : 3);
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, [2, 4, 8]);
}
console.log("buffers-transfer-mode-discriminant:ok");
