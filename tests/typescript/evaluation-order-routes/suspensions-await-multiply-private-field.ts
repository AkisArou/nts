/*---
description: "A private compound assignment retains its earlier value across await."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-function-types]
flags: [async]
---*/
// *= through a private class field; node retains the private value while another task replaces that field before resumption.
const log: string[] = [];
class Cell {
  #value: number;
  constructor(value: number) { log.push("new"); this.#value = value; }
  replace(value: number): void { log.push("replace:" + value); this.#value = value; }
  read(): number { log.push("read"); return this.#value; }
  async update(wait: () => Promise<number>): Promise<number> {
    log.push("update");
    return this.#value *= await wait();
  }
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [3, 7]) {
    const gate = Promise.withResolvers<number>(), cell = new Cell(initial);
    function wait(): Promise<number> { log.push("wait"); return gate.promise; }
    log.length = 0;
    const pending = cell.update(wait);
    Promise.resolve().then(() => { log.push("other"); cell.replace(100); gate.resolve(2); });
    const result = await pending;
    const stored = cell.read();
    assert.compareArray(log, ["update", "wait", "other", "replace:100", "read"]);
    assert.sameValue(result, initial * 2);
    assert.sameValue(stored, initial * 2);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
