/*---
description: "all rejects with the original Error object, not a replacement; route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all rejects with the original Error object, not a replacement. Route: readonly tuple row. Node prints all-reject-error-identity:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const reason = new TypeError("marker");
  const inputs: Iterable<Entry> = [1, Promise.reject(reason)];
  const rows: readonly [string, Iterable<Entry>][] = [["chosen", inputs]];
  const routed = rows[0][1];
  const joined = Promise.all(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, reason);
  assert.sameValue(caughtError instanceof TypeError, true);
  console.log("all-reject-error-identity:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
