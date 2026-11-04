/*---
description: "Control: A middle await preserves ordered object construction parts."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-record, ts-computed-keys]
flags: [async]
---*/
// Await in a object literal through interface getters; node keeps the earlier part and reads the later part after the competing mutation.
const log: string[] = [];
interface Source { readonly key: string; readonly first: number; readonly task: Promise<number>; readonly last: number; }
async function build(source: Source): Promise<Record<string, number>> {
  log.push("build");
  const key = source.key;
  const first = source.first;
  const task = source.task;
  const middle = await task;
  const last = source.last;
  return { [key]: first, middle: middle, tail: last };
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>();
    let current = initial, key = "left";
    const source: Source = {
      get key(): string { log.push("key:" + key); return key; },
      get first(): number { log.push("first"); return current; },
      get task(): Promise<number> { log.push("task"); return gate.promise; },
      get last(): number { log.push("last"); return current; }
    };
    log.length = 0;
    const pending = build(source);
    Promise.resolve().then(() => { log.push("other"); current = 99; key = "changed"; gate.resolve(7); });
    const result = await pending;
    assert.compareArray(log, ["build", "key:left", "first", "task", "other", "last"]);
    assert.compareArray(Object.keys(result), ["left", "middle", "tail"]);
    assert.sameValue(result.left, initial); assert.sameValue(result.middle, 7); assert.sameValue(result.tail, 99);
    assert.sameValue(current, 99);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
