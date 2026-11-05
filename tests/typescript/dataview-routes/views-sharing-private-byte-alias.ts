/*---
description: "An offset private DataView and a whole-buffer byte array immediately see each other's writes without touching surrounding bytes through a private view exposed through typed read and write methods."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

// An offset private DataView and a whole-buffer byte array immediately see each other's writes without touching surrounding bytes; route: a private view exposed through typed read and write methods.
// Node prints views-sharing-private-byte-alias:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
type Bytes = Uint8Array<ArrayBuffer>;
class PrivateWindow {
  buffer: BufferStorage = new ArrayBuffer(6);
  #view: View = new DataView(this.buffer, 2, 3);
  read(index: number): number { return this.#view.getUint8(index); }
  write(index: number, value: number): void { this.#view.setUint8(index, value); }
  backing(): BufferStorage { return this.#view.buffer; }
}
for (const value of [0, 127, 255]) {
  const store = new PrivateWindow(), bytes: Bytes = new Uint8Array(store.buffer), whole: View = new DataView(store.buffer);
  for (let i = 0; i < 6; i++) bytes[i] = i + 10;
  bytes[3] = value; assert.sameValue(store.read(1), value);
  store.write(2, 99); assert.sameValue(bytes[4], 99);
  assert.sameValue(store.backing() === store.buffer, true);
  const observed: number[] = []; for (let i = 0; i < 6; i++) observed[i] = whole.getUint8(i);
  assert.compareArray(observed, [10, 11, 12, value, 99, 15]);
}
console.log("views-sharing-private-byte-alias:ok");
