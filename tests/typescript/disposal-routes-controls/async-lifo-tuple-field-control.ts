/*---
description: An async-disposable tuple field awaits each cleanup completely in reverse declaration order before leaving its block.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-interfaces, ts-tuples, ts-arrays, ts-class, ts-class-fields, ts-null-undefined]
flags: [async]
---*/
// Explicit disposal control; Three async resources travel in a typed tuple field; node finishes each reverse-order cleanup after the last body statement and before the outside statement.
type Resource = AsyncDisposable | null | undefined;
interface Holder { entries: [Resource, Resource, Resource]; }
class Handle implements AsyncDisposable {
  id: number; log: unknown[];
  constructor(id: number, log: unknown[]) { this.id = id; this.log = log; }
  async [Symbol.asyncDispose](): Promise<void> { this.log.push("start", this); await Promise.resolve(); this.log.push("end", this); }
}
async function consume(holder: Holder, log: unknown[]): Promise<void> {
  { const first = holder.entries[0], second = holder.entries[1], third = holder.entries[2];
    const firstMethod = first == null ? undefined : first[Symbol.asyncDispose], secondMethod = second == null ? undefined : second[Symbol.asyncDispose], thirdMethod = third == null ? undefined : third[Symbol.asyncDispose];
    try {
      assert.sameValue(first, holder.entries[0]); assert.sameValue(second, holder.entries[1]); assert.sameValue(third, holder.entries[2]);
      log.push("body"); await Promise.resolve(); log.push("last");
    } finally {
      if (third != null && thirdMethod !== undefined) await thirdMethod.call(third);
      if (second != null && secondMethod !== undefined) await secondMethod.call(second);
      if (first != null && firstMethod !== undefined) await firstMethod.call(first);
      if (first == null && second == null && third == null) await Promise.resolve();
    }
  }
  log.push("outside");
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    const log: unknown[] = [], resources: Handle[] = [];
    for (let id = 0; id < count; id++) resources.push(new Handle(id, log));
    const holder: Holder = { entries: [resources[0], resources[1] ?? null, resources[2]] };
    log.push("before"); await consume(holder, log); log.push("after");
    const expected: unknown[] = ["before", "body", "last"];
    for (let id = count - 1; id >= 0; id--) expected.push("start", resources[id], "end", resources[id]);
    expected.push("outside", "after"); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
