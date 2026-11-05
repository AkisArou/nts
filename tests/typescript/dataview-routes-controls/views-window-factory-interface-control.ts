/*---
description: "Full and middle window factories retain their distinct geometry and the supplied buffer identity through an interface with two factory implementations. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class, ts-destructuring]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// Full and middle window factories retain their distinct geometry and the supplied buffer identity; route: an interface with two factory implementations. Node prints views-window-factory-interface:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = localGetUint8(view, i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = localArrayBuffer(input.length), view: View = localDataView(buffer);
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return buffer;
}
interface WindowMaker { create(buffer: BufferStorage): View; }
class WholeMaker implements WindowMaker { create(buffer: BufferStorage): View { return localDataView(buffer); } }
class MiddleMaker implements WindowMaker { create(buffer: BufferStorage): View { return localDataView(buffer, 1, 2); } }
const plans: readonly [WindowMaker, number, number][] = [[new WholeMaker(), 0, 4], [new MiddleMaker(), 1, 2]];
const inputs: readonly (readonly number[])[] = [[13, 26, 39, 52], [99, 88, 77, 66]];
for (const input of inputs) {
  const backing: BufferStorage = makeBuffer(input);
  for (const [maker, offset, length] of plans) {
    const view: View = maker.create(backing), expected: number[] = [];
    for (let i = 0; i < length; i++) expected[i] = input[offset + i];
    assert.sameValue(view.byteOffset, offset); assert.sameValue(view.byteLength, length);
    assert.sameValue(view.buffer, backing); assert.compareArray(readBytes(view), expected);
  }
}
console.log("views-window-factory-interface:ok");
