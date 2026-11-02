/*---
description: Optional async resources held in fields retain identity and await each disposer before the next one starts.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this, ts-async]
flags: [async]
---*/
// A field carries optional AsyncDisposable resources into use; node awaits start and end pairs in reverse order and skips nullish values.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T;
}
interface Holder { resource: AsyncDisposable | null | undefined; }
async function main(): Promise<void> {
  const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new AsyncDisposableStack(), holders: Holder[] = [];
    for (const id of row) holders.push({ resource: id === null || id === undefined ? id : { async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); } } });
    assert.sameValue(stack.disposed, false);
    for (const holder of holders) { const registered = stack.use(holder.resource);
    assert.sameValue(registered, holder.resource); }
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = holders.length - 1; i >= 0; i--) if (row[i] !== null && row[i] !== undefined) expected.push("start", row[i], holders[i].resource, true, "end", row[i]); expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
    const late: AsyncDisposable = { async [Symbol.asyncDispose](): Promise<void> { log.push("late"); } };
    assert.throws(ReferenceError, () => stack.use(late)); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
