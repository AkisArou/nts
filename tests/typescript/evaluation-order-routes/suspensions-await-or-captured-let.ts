/*---
description: "Captured bitwise assignment retains its left value across await."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-closures, ts-expressions]
flags: [async]
---*/
// |= through a captured let; node saves the old bits before await, then replaces a competing write on resumption.
const log: string[] = [];
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[1, 3], [4, 6]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>();
    let current: number = row[0];
    function wait(): Promise<number> { log.push("wait"); return gate.promise; }
    async function update(): Promise<number> {
      log.push("update");
      return current |= await wait();
    }
    log.length = 0;
    const pending = update();
    Promise.resolve().then(() => { log.push("other"); current = 128; gate.resolve(2); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(current, row[1]);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
