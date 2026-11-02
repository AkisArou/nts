/*---
description: Explicit function-record control for Class constructors carried by a construct-signature array reject call before entering the constructor.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-construct-signatures, ts-errors, ts-objects]
---*/
// Classes cross an array of construct signatures; call throws TypeError without mutating the receiver or running either constructor.
interface Packet { value: number; }
let entered = 0;
interface Constructor { create: (value: number) => Packet; callable: boolean; }
const choices: Constructor[] = [{ create(value: number): Packet { entered++; return { value }; }, callable: false }, { create(value: number): Packet { entered++; return { value }; }, callable: false }];
function invoke(Ctor: Constructor, receiver: Packet, value: number): void { if (!Ctor.callable) throw new TypeError("class is not callable"); receiver.value = Ctor.create(value).value; }
for (const Ctor of choices) for (const value of [-0, NaN, 7]) {
  const receiver: Packet = { value: 99 };
  assert.throws(TypeError, () => invoke(Ctor, receiver, value));
  assert.sameValue(receiver.value, 99); assert.sameValue(entered, 0);
}
