/*---
description: "Generator yield order determines priority among already settled inputs. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// Generator yield order determines priority among already settled inputs. Route: Map lookup. Node prints race-generator-order:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  function* stream(): Generator<Item> { yield Promise.resolve(5); yield 7; }
  const inputs: Iterable<Item> = stream();
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 5);
  console.log("race-generator-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
