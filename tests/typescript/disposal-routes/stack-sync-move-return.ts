/*---
description: A generic resource parameter moves ownership into a returned stack while the original becomes permanently disposed.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this]
---*/
// A generic parameter carries optional resources into a returned moved stack; node transfers ownership without disposing until the new owner is closed.
interface Stack { readonly disposed: boolean; dispose(): void;
  use<T extends Disposable | null | undefined>(value: T): T;
  adopt<T>(value: T, callback: (value: T) => void): T;
  defer(callback: () => void): void;
  move(): Stack;
}
function transfer<T extends Disposable | null | undefined>(source: Stack, resources: T[]): Stack { for (const resource of resources) source.use(resource); return source.move(); }
for (const count of [0, 1, 3]) {
  const log: unknown[] = ["before"], source: Stack = new DisposableStack(), resources: (Disposable | null | undefined)[] = [null, undefined]; let owner: Stack = source;
  for (let id = 0; id < count; id++) resources.push({ [Symbol.dispose](): void { log.push("dispose", id, this, source.disposed, owner.disposed); } });
  owner = transfer(source, resources); log.push("moved");
  assert.sameValue(owner === source, false); assert.sameValue(source.disposed, true); assert.sameValue(owner.disposed, false); assert.compareArray(log, ["before", "moved"]);
  const late: Disposable = { [Symbol.dispose](): void { log.push("late"); } };
  assert.throws(ReferenceError, () => source.use(late)); assert.throws(ReferenceError, () => source.adopt(late, () => log.push("late-adopt")));
  assert.throws(ReferenceError, () => source.defer(() => log.push("late-defer"))); assert.throws(ReferenceError, () => source.move());
  source.dispose(); assert.compareArray(log, ["before", "moved"]); owner.defer(() => log.push("new-owner", owner.disposed));
  owner.dispose(); log.push("after"); const expected: unknown[] = ["before", "moved", "new-owner", true];
  for (let i = count - 1; i >= 0; i--) expected.push("dispose", i, resources[i + 2], true, true); expected.push("after");
  assert.sameValue(owner.disposed, true); assert.compareArray(log, expected); source.dispose(); owner.dispose(); assert.compareArray(log, expected);
}
