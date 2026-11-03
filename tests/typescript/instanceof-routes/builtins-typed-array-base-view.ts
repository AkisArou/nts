/*---
description: ArrayBufferView parameters retain Uint8Array subclass ancestry and reject equal-shaped impostors.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-instanceof]
---*/
// ByteList, its descendants, sibling views and a same-shaped literal cross ArrayBufferView; node answers by the Uint8Array and ByteList chains.
class ByteList extends Uint8Array {}
class ByteChild extends ByteList {}
class ByteSibling extends Uint8Array {}
function classify(view: ArrayBufferView): [boolean, boolean] {
  return [view instanceof Uint8Array, view instanceof ByteList];
}
const samples: [ArrayBufferView, boolean, boolean][] = [
  [new ByteList(2), true, true], [new ByteChild(2), true, true], [new ByteSibling(2), true, false],
  [new Uint8Array(2), true, false], [new Int8Array(2), false, false], [new DataView(new ArrayBuffer(2)), false, false],
  [{ buffer: new ArrayBuffer(2), byteOffset: 0, byteLength: 2 }, false, false]
];
for (const [view, isByteArray, isList] of samples) {
  const answers = classify(view);
  assert.compareArray(answers, [isByteArray, isList]);
}
