/*---
description: "all rejects even when another input never settles; route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all rejects even when another input never settles. Route: private class field. Node prints all-reject-while-other-pending:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function failure(reason: unknown, turns: number): Promise<Data> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i++) chain = chain.then(() => undefined);
  return chain.then(() => { throw reason; });
}
async function main(): Promise<void> {
  const reason = { id: 33 };
  const pending = new Promise<Data>(() => {});
  const inputs: Iterable<Entry> = [pending, failure(reason, 1)];
  class Queue { #items: Iterable<Entry>; constructor(items: Iterable<Entry>) { this.#items = items; } read(): Iterable<Entry> { return this.#items; } }
  const routed = new Queue(inputs).read();
  const joined = Promise.all(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, reason);
  console.log("all-reject-while-other-pending:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
