/*---
description: "Compound addition defers its saved object conversion until after await."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-function-types, ts-unsound-object-assign, ts-to-primitive, ts-conversions, ts-symbols, ts-bigint, ts-unions, ts-unknown, ts-errors]
flags: [async]
---*/
// += through a widened numeric accessor; node saves the object before await but converts it after the competing mutation.
const log: string[] = [];
interface Source { value: number; }
async function update(source: Source, wait: () => Promise<number>): Promise<number> {
  log.push("update");
  return source.value += await wait();
}
async function main(): Promise<void> {
  log.push("main");
  for (const mixed of [false, true]) {
    const gate = Promise.withResolvers<number>();
    const payload: { value: number | bigint } = { value: 2 };
    const slot = { value: 0 }; let written = 0;
    Object.assign(slot, { value: { [Symbol.toPrimitive](hint: string): number | bigint { log.push("convert:" + hint + ":" + payload.value); return payload.value; } } });
    const source: Source = { get value(): number { log.push("get"); return slot.value; }, set value(value: number) { log.push("set:" + value); written = value; slot.value = value; } };
    function wait(): Promise<number> { log.push("wait"); return gate.promise; }
    log.length = 0;
    const pending = update(source, wait);
    Promise.resolve().then(() => { log.push("other"); payload.value = mixed ? 20n : 20; gate.resolve(2); });
    let result: number | undefined, caught: unknown;
    try { result = await pending; } catch (error) { log.push("caught"); caught = error; }
    const expected = ["update", "get", "wait", "other", "convert:default:20", mixed ? "caught" : "set:22"];
    assert.compareArray(log, expected);
    assert.sameValue(caught instanceof TypeError, mixed);
    assert.sameValue(result, mixed ? undefined : 22);
    assert.sameValue(written, mixed ? 0 : 22);
    assert.sameValue(payload.value, mixed ? 20n : 20);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
