/*---
description: "A suspended argument list retains its callee and receiver while later arguments stay live."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-function-types, ts-type-aliases, ts-this, ts-this-parameter, ts-strings, ts-errors]
flags: [async]
---*/
// Await in typed method arguments; node keeps the old method and receiver, but reads the final argument from the new holder after resumption.
const log: string[] = [];
type Method = (this: Receiver, a: number, b: number, c: number) => string;
interface Receiver { label: string; state: number; method: Method; readonly first: number; readonly task: Promise<number>; readonly last: number; }
interface Holder { value: Receiver; }
function original(this: Receiver, a: number, b: number, c: number): string { log.push("call:" + this.label + ":" + this.state); return this.label + ":" + this.state + ":" + a + ":" + b + ":" + c; }
function replacement(this: Receiver, a: number, b: number, c: number): string { log.push("wrong-call"); throw new Error("reselected callee"); }
async function invoke(holder: Holder): Promise<string> {
  log.push("invoke");
  return holder.value.method(holder.value.first, await holder.value.task, holder.value.last);
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>(); let selected: Method = original;
    const first: Receiver = { label: "first", state: initial,
      get method(): Method { log.push("method"); return selected; },
      get first(): number { log.push("first"); return this.state; },
      get task(): Promise<number> { log.push("task"); return gate.promise; },
      get last(): number { log.push("last:old"); return this.state; }
    };
    const second: Receiver = { label: "second", state: 200, method: replacement, first: 80, task: gate.promise, get last(): number { log.push("last:new"); return this.state; } };
    const holder: Holder = { value: first };
    log.length = 0;
    const pending = invoke(holder);
    Promise.resolve().then(() => { log.push("other"); first.state = 99; selected = replacement; holder.value = second; gate.resolve(7); });
    const result = await pending;
    assert.compareArray(log, ["invoke", "method", "first", "task", "other", "last:new", "call:first:99"]);
    assert.sameValue(result, "first:99:" + initial + ":7:200");
    assert.sameValue(holder.value, second);
    assert.sameValue(first.state, 99);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
