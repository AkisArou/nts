/*---
description: "a throwing iterator next makes all reject rather than throw synchronously; route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// a throwing iterator next makes all reject rather than throw synchronously. Route: readonly tuple row. Node prints all-throwing-next-rejection:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("next");
  const inputs: Iterable<Entry> = { [Symbol.iterator](): Iterator<Entry> { return { next(): IteratorResult<Entry> { throw reason; } }; } };
  const rows: readonly [string, Iterable<Entry>][] = [["chosen", inputs]];
  const routed = rows[0][1];
  const joined = Promise.all(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, reason);
  console.log("all-throwing-next-rejection:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
