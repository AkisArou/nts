/*---
description: "A middle await preserves ordered template construction parts."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-template-literals, ts-to-primitive, ts-conversions, ts-strings]
flags: [async]
---*/
// Await in a template literal through interface getters; node keeps the earlier part and reads the later part after the competing mutation.
const log: string[] = [];
interface TextValue { toString(): string; }
interface Source { readonly first: TextValue; readonly task: Promise<number>; readonly last: TextValue; }
async function build(source: Source): Promise<string> {
  log.push("build");
  return `${source.first}/${await source.task}/${source.last}`;
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>();
    let current = initial, key = "left";
    const firstText: TextValue = { toString(): string { log.push("convert:first:" + current); return "v" + current; } };
    const lastText: TextValue = { toString(): string { log.push("convert:last:" + current); return "v" + current; } };
    const source: Source = {
      get first(): TextValue { log.push("first"); return firstText; },
      get task(): Promise<number> { log.push("task"); return gate.promise; },
      get last(): TextValue { log.push("last"); return lastText; }
    };
    log.length = 0;
    const pending = build(source);
    Promise.resolve().then(() => { log.push("other"); current = 99; key = "changed"; gate.resolve(7); });
    const result = await pending;
    assert.compareArray(log, ["build", "first", "convert:first:" + initial, "task", "other", "last", "convert:last:99"]);
    assert.sameValue(result, "v" + initial + "/7/v99");
    assert.sameValue(current, 99);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
