/*---
description: A disposable union selects async methods first and ignores values returned by the synchronous fallback.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-this, ts-async]
flags: [async]
---*/
// A union array carries sync, async and dual resources into use; node awaits async methods and never assimilates a sync disposer return value.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T;
}
type Resource = Disposable | AsyncDisposable;
async function main(): Promise<void> {
  const rows: string[][] = [[], ["sync"], ["async"], ["dual"], ["sync", "dual", "async"]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new AsyncDisposableStack(), resources: Resource[] = [];
    for (let id = 0; id < row.length; id++) {
      const kind = row[id];
      if (kind === "sync") resources.push({ [Symbol.dispose]() { log.push("sync", id, this, stack.disposed); return { then(): void { log.push("assimilated"); throw new Error("sync return observed"); } }; } });
      else if (kind === "dual") resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); }, [Symbol.dispose](): void { log.push("wrong-sync", id); } });
      else resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); } });
    }
    for (const resource of resources) assert.sameValue(stack.use(resource), resource);
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = resources.length - 1; i >= 0; i--) { if (row[i] === "sync") expected.push("sync", i, resources[i], true); else expected.push("start", i, resources[i], true, "end", i); } expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
