/*---
description: "all preserves negative zero, NaN and infinities among plain inputs; route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all preserves negative zero, NaN and infinities among plain inputs. Route: readonly tuple row. Node prints all-plain-numbers-tuple:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = [-0, NaN, Infinity, -Infinity];
  const rows: readonly [string, Iterable<Entry>][] = [["chosen", inputs]];
  const routed = rows[0][1];
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, [-0, NaN, Infinity, -Infinity]);
  console.log("all-plain-numbers-tuple:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
