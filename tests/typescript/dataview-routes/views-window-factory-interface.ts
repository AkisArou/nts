/*---
description: "Full and middle window factories retain their distinct geometry and the supplied buffer identity through an interface with two factory implementations."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class, ts-destructuring]
---*/

// Full and middle window factories retain their distinct geometry and the supplied buffer identity; route: an interface with two factory implementations. Node prints views-window-factory-interface:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = new ArrayBuffer(input.length), view: View = new DataView(buffer);
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return buffer;
}
interface WindowMaker { create(buffer: BufferStorage): View; }
class WholeMaker implements WindowMaker { create(buffer: BufferStorage): View { return new DataView(buffer); } }
class MiddleMaker implements WindowMaker { create(buffer: BufferStorage): View { return new DataView(buffer, 1, 2); } }
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
