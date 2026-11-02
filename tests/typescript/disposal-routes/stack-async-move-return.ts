/*---
description: A generic async resource route transfers ownership to a returned stack without starting disposal.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this, ts-async]
flags: [async]
---*/
// A generic parameter carries optional AsyncDisposable resources into move; node makes the source inert and awaits cleanup only through the returned owner.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T;
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T;
  defer(callback: () => PromiseLike<void> | void): void;
  move(): Stack;
}
function transfer<T extends AsyncDisposable | null | undefined>(source: Stack, resources: T[]): Stack { for (const resource of resources) source.use(resource); return source.move(); }
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    const log: unknown[] = ["before"], source: Stack = new AsyncDisposableStack(), resources: (AsyncDisposable | null | undefined)[] = [null, undefined]; let owner: Stack = source;
    for (let id = 0; id < count; id++) resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, source.disposed, owner.disposed); await Promise.resolve(); log.push("end", id); } });
    owner = transfer(source, resources); log.push("moved");
    assert.sameValue(owner === source, false); assert.sameValue(source.disposed, true); assert.sameValue(owner.disposed, false); assert.compareArray(log, ["before", "moved"]);
    const late: AsyncDisposable = { async [Symbol.asyncDispose](): Promise<void> { log.push("late"); } };
    assert.throws(ReferenceError, () => source.use(late)); assert.throws(ReferenceError, () => source.adopt(late, () => { log.push("late-adopt"); }));
    assert.throws(ReferenceError, () => source.defer(() => { log.push("late-defer"); })); assert.throws(ReferenceError, () => source.move());
    await source.disposeAsync(); assert.compareArray(log, ["before", "moved"]); owner.defer(async () => { log.push("new-owner", owner.disposed); await Promise.resolve(); log.push("new-end"); });
    await owner.disposeAsync(); log.push("after"); const expected: unknown[] = ["before", "moved", "new-owner", true, "new-end"];
    for (let i = count - 1; i >= 0; i--) expected.push("start", i, resources[i + 2], true, true, "end", i); expected.push("after");
    assert.sameValue(owner.disposed, true); assert.compareArray(log, expected); await source.disposeAsync(); await owner.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
