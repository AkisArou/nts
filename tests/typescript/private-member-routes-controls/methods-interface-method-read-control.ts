/*---
description: A method-interface receiver must hold the private method to read it, while its field-free body accepts an explicit unrelated receiver. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-interfaces, ts-unsound-bivariance, ts-this, ts-this-parameter, ts-function-types, ts-inheritance, ts-tuples, ts-map-set]
---*/
// MethodOwner instances cross a widened read interface; node rejects a missing method brand and leaves an extracted field-free function unbound. The control stores each private name in its own checked Map.
const methodsByOwner = new Map<object, (this: object) => object>(), otherMethods = new Map<object, (this: object) => object>();
function privateSelf(this: object): object { return this; }
function otherSelf(this: object): object { return this; }
class MethodOwner {
  label: string = "same";
  constructor() { methodsByOwner.set(this, privateSelf); }
  static read(target: MethodOwner): (this: object) => object { if (!methodsByOwner.has(target)) throw new TypeError(); const method = methodsByOwner.get(target); if (method === undefined) throw new Error("missing method"); return method; }
}
class Other { label: string = "same"; constructor() { otherMethods.set(this, otherSelf); } }
class Child extends MethodOwner {}
interface Reader { read(target: object): (this: object) => object; }
const reader: Reader = MethodOwner;
for (const order of [false, true, false]) {
  const first: MethodOwner = order ? new MethodOwner() : new Child(), child: MethodOwner = order ? new Child() : new MethodOwner(), plain = { label: "same" }, other = new Other();
  const method = reader.read(first), entries: [object, boolean][] = order ? [[first, true], [other, false], [child, true], [plain, false]] : [[plain, false], [child, true], [other, false], [first, true]];
  for (const [target, valid] of entries) {
    if (valid) {
      const result = reader.read(target); assert.sameValue(result, method); assert.sameValue(result.call(target), target); assert.sameValue(result.call(plain), plain);
    } else assert.throws(TypeError, () => reader.read(target));
  }
}
