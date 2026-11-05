/*---
description: "all rejects with the second input when it rejects earlier; route: interface input field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all rejects with the second input when it rejects earlier. Route: interface input field. Node prints all-reject-later-position-first:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function failure(reason: unknown, turns: number): Promise<Data> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i++) chain = chain.then(() => undefined);
  return chain.then(() => { throw reason; });
}
async function main(): Promise<void> {
  const a = { id: 1 };
  const b = { id: 2 };
  const inputs: Iterable<Entry> = [failure(a, 3), failure(b, 1)];
  interface Holder { readonly items: Iterable<Entry>; }
  const owner: Holder = { items: inputs };
  const routed = owner.items;
  const joined = Promise.all(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, b);
  console.log("all-reject-later-position-first:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
