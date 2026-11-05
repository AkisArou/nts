/*---
description: "An offset private DataView and a whole-buffer byte array immediately see each other's writes without touching surrounding bytes through a private view exposed through typed read and write methods."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }
function localUint8Array(buffer: number[]): number[] { return buffer; }

// An offset private DataView and a whole-buffer byte array immediately see each other's writes without touching surrounding bytes; route: a private view exposed through typed read and write methods.
// Node prints views-sharing-private-byte-alias:ok.
type BufferStorage = number[];
type View = LocalView;
type Bytes = number[];
class PrivateWindow {
  buffer: BufferStorage = localArrayBuffer(6);
  #view: View = localDataView(this.buffer, 2, 3);
  read(index: number): number { return localGetUint8(this.#view, index); }
  write(index: number, value: number): void { localSetUint8(this.#view, index, value); }
  backing(): BufferStorage { return this.#view.buffer; }
}
for (const value of [0, 127, 255]) {
  const store = new PrivateWindow(), bytes: Bytes = localUint8Array(store.buffer), whole: View = localDataView(store.buffer);
  for (let i = 0; i < 6; i++) bytes[i] = i + 10;
  bytes[3] = value; assert.sameValue(store.read(1), value);
  store.write(2, 99); assert.sameValue(bytes[4], 99);
  assert.sameValue(store.backing() === store.buffer, true);
  const observed: number[] = []; for (let i = 0; i < 6; i++) observed[i] = localGetUint8(whole, i);
  assert.compareArray(observed, [10, 11, 12, value, 99, 15]);
}
console.log("views-sharing-private-byte-alias:ok");
