/*---
description: A callback assigns a definite numeric field after an observable unassigned read and keeps both write order and exact values. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-class, ts-class-fields, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-unions]
---*/
// A definite field claim crosses a declared class field and delayed callback; node reads undefined before the call and the exact assigned number afterward. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
class DeferredNumber { value: number | undefined; }
for (const next of [-0, 0, NaN, 7.25]) {
  const slot: DeferredNumber = new DeferredNumber(), log: unknown[] = [];
  const write: () => void = () => {
    log.push("before-write", slot.value);
    slot.value = next;
    log.push("after-write", slot.value);
  };
  log.push("queued", slot.value);
  same(slot.value, undefined);
  write();
  const value = slot.value;
  same(value, next);
  log.push("read", value);
  const expected: unknown[] = ["queued", undefined, "before-write", undefined, "after-write", next, "read", next];
  assert.compareArray(log, expected);
  for (let index = 0; index < log.length; index++) same(log[index], expected[index]);
}
