/*---
description: A constructor array keeps static private reads and writes on the declaring constructor only.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-class-fields, ts-inheritance, ts-typeof-type, ts-unknown, ts-numbers, ts-bigint, ts-null-undefined, ts-objects, ts-this, ts-private-fields]
---*/
// StaticCell constructors cross a typeof array; node reads and writes the owner value and throws for each subclass without changing it.
class StaticCell {
  static #value: unknown = undefined;
  static read(): unknown { return this.#value; }
  static write(value: unknown): unknown { return this.#value = value; }
}
class StaticChild extends StaticCell {}
class StaticLeaf extends StaticChild {}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { id: 1 }, [1]];
const receivers: (typeof StaticCell)[] = [StaticLeaf, StaticCell, StaticChild, StaticCell];
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length];
  assert.sameValue(StaticCell.write(value), value);
  for (const receiver of receivers) {
    if (receiver === StaticCell) {
      assert.sameValue(receiver.read(), value); assert.sameValue(receiver.write(next), next);
      assert.sameValue(receiver.read(), next); assert.sameValue(receiver.write(value), value);
    } else {
      assert.throws(TypeError, () => receiver.read());
      assert.throws(TypeError, () => receiver.write(next));
    }
    assert.sameValue(StaticCell.read(), value);
  }
}
