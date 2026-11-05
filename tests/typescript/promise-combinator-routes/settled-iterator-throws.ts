/*---
description: "Throwing iterator next rejects the returned promise. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Throwing iterator next rejects the returned promise. Route: readonly tuple row. Node prints settled-iterator-throws:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("next"); function bad(): Iterable<Item> { return { [Symbol.iterator](): Iterator<Item> { return { next(): IteratorResult<Item> { throw reason; } }; } }; }
  const inputs: Iterable<Item> = bad();
  const rows: readonly [string, Iterable<Item>][] = [["s", inputs]]; const routed = rows[0][1];
  const joined = Promise.allSettled(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; } assert.sameValue(caught, reason);
  console.log("settled-iterator-throws:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
