/*---
description: "all adopts a thenable that throws before resolving and rejects with that reason; route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all adopts a thenable that throws before resolving and rejects with that reason. Route: static class field. Node prints all-thenable-throw-before:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const reason = { id: 71 };
  const thenable: Thenable = { then(resolve, reject): void { throw reason; } };
  const inputs: Iterable<Entry> = [thenable];
  class StaticHolder { static items: Iterable<Entry>; }
  StaticHolder.items = inputs;
  const routed = StaticHolder.items;
  const joined = Promise.all(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, reason);
  console.log("all-thenable-throw-before:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
