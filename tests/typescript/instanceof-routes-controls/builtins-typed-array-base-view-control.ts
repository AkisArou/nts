/*---
description: ArrayBufferView parameters retain Uint8Array subclass ancestry and reject equal-shaped impostors. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-narrowing, ts-typeof-operator]
---*/
// ByteList, its descendants, sibling views and a same-shaped literal cross ArrayBufferView; node answers by the Uint8Array and ByteList chains. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
class ByteList extends Uint8Array {}
class ByteChild extends ByteList {}
class ByteSibling extends Uint8Array {}
function classify(view: ArrayBufferView): [boolean, boolean] {
  return [follows(view, Uint8Array.prototype), follows(view, ByteList.prototype)];
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
