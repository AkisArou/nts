/*---
description: Class constructors carried by a construct-signature array reject call before entering the constructor.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-construct-signatures, ts-errors, ts-objects]
---*/
// Classes cross an array of construct signatures; call throws TypeError without mutating the receiver or running either constructor.
interface Packet { value: number; }
let entered = 0;
class First { value: number; constructor(value: number) { entered++; this.value = value; } }
class Second { value: number; constructor(value: number) { entered++; this.value = value; } }
type Constructor = new (value: number) => Packet;
const choices: Constructor[] = [First, Second];
function invoke(Ctor: Constructor, receiver: Packet, value: number): void { Ctor.call(receiver, value); }
for (const Ctor of choices) for (const value of [-0, NaN, 7]) {
  const receiver: Packet = { value: 99 };
  assert.throws(TypeError, () => invoke(Ctor, receiver, value));
  assert.sameValue(receiver.value, 99); assert.sameValue(entered, 0);
}
