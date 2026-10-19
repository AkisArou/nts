/*---
description: A valueOf that returns an object is skipped for toString; when both return objects, conversion throws TypeError.
features: [ts-conversions, ts-to-primitive, ts-class]
---*/
class Fallback {
  valueOf(): object {
    return {};
  }
  toString(): string {
    return "12";
  }
}
class Broken {
  valueOf(): object {
    return {};
  }
  toString(): object {
    return [];
  }
}
assert.sameValue(+new Fallback(), 12);
assert.throws(TypeError, () => {
  const converted = +new Broken();
  assert.sameValue(converted, 0);
});
