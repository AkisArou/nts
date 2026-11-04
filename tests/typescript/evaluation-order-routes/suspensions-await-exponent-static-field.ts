/*---
description: "Static exponent assignment saves its base before awaiting the exponent."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-class, ts-class-fields, ts-static, ts-function-types, ts-exponent]
flags: [async]
---*/
// **= through a typed class value; node saves the static base before await and overwrites another task's later write.
const log: string[] = [];
class Counter {
  static value: number = 0;
  static async update(wait: () => Promise<number>): Promise<number> {
    log.push("update");
    return this.value **= await wait();
  }
}
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[3, 9], [5, 25]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>(), target: typeof Counter = Counter;
    function wait(): Promise<number> { log.push("wait"); return gate.promise; }
    target.value = row[0]; log.length = 0;
    const pending = target.update(wait);
    Promise.resolve().then(() => { log.push("other"); target.value = 100; gate.resolve(2); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(target.value, row[1]);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
