/*---
description: A static block can call a private method declared later in the class body. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-class-static-block, ts-tuples, ts-typeof-type, ts-this]
---*/
// OrderedStatic crosses constructor tuple slots; node installs a later private method before the static block, yielding the complete method/set/get log.
for (const seed of [-2, 0, 3, 9]) {
  const log: string[] = [];
  let secret: number = seed;
  let declaringConstructor: object | undefined;
  function double(receiver: object): number { if (receiver !== declaringConstructor) throw new TypeError(); log.push("method"); return secret * 2; }
  function getCurrent(receiver: object): number { if (receiver !== declaringConstructor) throw new TypeError(); log.push("get"); return secret; }
  function setCurrent(receiver: object, value: number): void { if (receiver !== declaringConstructor) throw new TypeError(); log.push("set"); secret = value; }
  class OrderedStatic {
    static {
      declaringConstructor = this;
      if (this !== OrderedStatic) throw new TypeError(); const value = double(this);
      if (this !== OrderedStatic) throw new TypeError(); setCurrent(this, value);
    }
    static read(): number { if (this !== OrderedStatic) throw new TypeError(); return getCurrent(this); }
  }
  const pair: [typeof OrderedStatic, typeof OrderedStatic] = [OrderedStatic, OrderedStatic];
  assert.compareArray(log, ["method", "set"]);
  for (const receiver of pair) assert.sameValue(receiver.read(), seed * 2);
  assert.sameValue(pair[0], pair[1]); assert.compareArray(log, ["method", "set", "get", "get"]);
}
