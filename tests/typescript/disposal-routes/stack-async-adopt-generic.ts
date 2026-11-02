/*---
description: Generic adopted disposable values retain identity while their asynchronous callbacks complete in reverse order.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this, ts-async]
flags: [async]
---*/
// A constrained generic carries Disposable or nullish values into async adopt; node awaits every callback and passes each exact value with undefined this.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T;
}
function enroll<T extends Disposable | null | undefined>(stack: Stack, value: T, log: unknown[]): T {
  return stack.adopt(value, async function (this: void, item: T): Promise<void> { log.push("start", item, this, stack.disposed); await Promise.resolve(); log.push("end", item); });
}
async function main(): Promise<void> {
  const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new AsyncDisposableStack(), values: (Disposable | null | undefined)[] = [];
    for (const id of row) values.push(id === null || id === undefined ? id : { [Symbol.dispose](): void { log.push("unused", id); } });
    assert.sameValue(stack.disposed, false); for (const value of values) assert.sameValue(enroll(stack, value, log), value);
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = values.length - 1; i >= 0; i--) expected.push("start", values[i], undefined, true, "end", values[i]); expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
    assert.throws(ReferenceError, () => enroll(stack, null, log)); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
