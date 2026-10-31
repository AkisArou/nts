/*---
description: Object.assign through a typed parameter updates an own class instance and retains its identity and method.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-objects, ts-instanceof, ts-typeof-type]
---*/
// Route: Object.assign through a typed parameter onto an own class instance; node preserves the target and argument semantics.
class Record {
  value: number;
  constructor(value: number) { this.value = value; }
  read(): number { return this.value + 100; }
}
function update(assign: typeof Object.assign, target: Record, source: { value: number }): Record {
  return assign(target, source);
}
for (const n of [-4, 0, 6]) {
  const target = new Record(n);
  const result = update(Object.assign, target, { value: n + 7 });
  assert.sameValue(result, target);
  assert.sameValue(result instanceof Record, true);
  assert.sameValue(target.value, n + 7);
  assert.sameValue(target.read(), n + 107);
}
