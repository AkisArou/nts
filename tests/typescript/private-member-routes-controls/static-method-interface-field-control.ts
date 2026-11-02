/*---
description: A static private method is called only on its declaring constructor through an interface field. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-interfaces, ts-class-fields, ts-inheritance, ts-objects, ts-this]
---*/
// StaticMethod travels through a ReceiverPort field; node returns the exact constructor from the private method and rejects inherited calls before its body runs.
interface ReceiverPort { receiver(): object; }
function methodSelf(this: typeof StaticMethod): object { this.calls++; return this; }
class StaticMethod {
  static calls: number = 0;
  static receiver(): object { if (this !== StaticMethod) throw new TypeError(); return methodSelf.call(this); }
}
class StaticChild extends StaticMethod {}
class StaticLeaf extends StaticChild {}
let expected = 0;
const receivers: ReceiverPort[] = [StaticMethod, StaticChild, StaticMethod, StaticLeaf, StaticMethod];
const holder: { port: ReceiverPort } = { port: StaticMethod };
for (const receiver of receivers) {
  holder.port = receiver; assert.sameValue(holder.port, receiver);
  if (receiver === StaticMethod) {
    assert.sameValue(holder.port.receiver(), StaticMethod); expected++;
  } else assert.throws(TypeError, () => holder.port.receiver());
  assert.sameValue(StaticMethod.calls, expected);
  assert.sameValue(StaticChild.calls, expected); assert.sameValue(StaticLeaf.calls, expected);
}
