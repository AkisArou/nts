/*---
description: A parameter property with a default takes the default when the argument is omitted or undefined.
features: [ts-class, ts-parameter-properties, ts-default-parameters]
---*/
class Retry {
  constructor(public attempts: number = 3, public delay: number = attempts * 100) {}
}
assert.sameValue(new Retry().attempts, 3);
assert.sameValue(new Retry().delay, 300);
assert.sameValue(new Retry(5).delay, 500);
assert.sameValue(new Retry(undefined, 7).attempts, 3);
