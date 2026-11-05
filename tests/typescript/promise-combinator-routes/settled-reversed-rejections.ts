/*---
description: "Rejected records retain input order despite opposite settlement order. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Rejected records retain input order despite opposite settlement order. Route: discriminated union. Node prints settled-reversed-rejections:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function fail(reason: unknown, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => { throw reason; }); }
async function main(): Promise<void> {
  const a = { id: 1 }, b = { id: 2 };
  const inputs: Iterable<Item> = [fail(a, 4), fail(b, 1)];
  type Choice = { tag: "yes"; xs: Iterable<Item> } | { tag: "no"; xs: Iterable<Item> }; const choice: Choice = { tag: "yes", xs: inputs }; const routed = choice.xs;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status), ["rejected", "rejected"]); if (value[0].status === "rejected" && value[1].status === "rejected") { assert.sameValue(value[0].reason, a); assert.sameValue(value[1].reason, b); }
  console.log("settled-reversed-rejections:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
