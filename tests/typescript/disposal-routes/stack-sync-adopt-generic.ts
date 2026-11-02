/*---
description: Generic disposable values adopted with explicit callbacks are returned unchanged and cleaned up even when nullish.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this]
---*/
// A constrained generic carries Disposable or nullish values into adopt; node calls each callback with its value and undefined this in reverse order.
interface Stack { readonly disposed: boolean; dispose(): void;
  adopt<T>(value: T, callback: (value: T) => void): T;
}
function enroll<T extends Disposable | null | undefined>(stack: Stack, value: T, log: unknown[]): T {
  return stack.adopt(value, function (this: void, item: T): void { log.push("adopt", item, this, stack.disposed); });
}
const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
for (const row of rows) {
  const log: unknown[] = ["before"], stack: Stack = new DisposableStack(), values: (Disposable | null | undefined)[] = [];
  for (const id of row) values.push(id === null || id === undefined ? id : { [Symbol.dispose](): void { log.push("unused", id); } });
  assert.sameValue(stack.disposed, false);
  for (const value of values) assert.sameValue(enroll(stack, value, log), value);
  log.push("inside"); assert.compareArray(log, ["before", "inside"]); stack.dispose(); log.push("after");
  const expected: unknown[] = ["before", "inside"]; for (let i = values.length - 1; i >= 0; i--) expected.push("adopt", values[i], undefined, true); expected.push("after");
  assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
  assert.throws(ReferenceError, () => enroll(stack, null, log)); stack.dispose(); assert.compareArray(log, expected);
}
