/*---
description: An async-disposable interface field keeps the cleanup method captured at acquisition even when the body replaces that method.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-interfaces, ts-function-types, ts-arrays, ts-this, ts-this-parameter]
flags: [async]
---*/
// Explicit disposal control; A resource in an interface field changes its async-dispose member after acquisition; node invokes the captured original with the same resource as this.
interface Handle extends AsyncDisposable { id: number; [Symbol.asyncDispose]: (this: Handle) => Promise<void>; }
interface Holder { resource: Handle; }
function make(id: number, log: unknown[]): Handle { return { id, async [Symbol.asyncDispose](): Promise<void> { log.push("original", this); await Promise.resolve(); log.push("end", this); } }; }
async function consume(holder: Holder, replacement: (this: Handle) => Promise<void>, log: unknown[]): Promise<void> {
  { const current = holder.resource, method = current[Symbol.asyncDispose]; current[Symbol.asyncDispose] = replacement;
    try { assert.sameValue(current, holder.resource); log.push("body"); }
    finally { await method.call(current); }
  }
  log.push("outside");
}
async function main(): Promise<void> {
  for (const id of [0, 1, 3]) {
    const log: unknown[] = [], holder: Holder = { resource: make(id, log) };
    const replacement = async function(this: Handle): Promise<void> { log.push("replacement", this); };
    const pending = consume(holder, replacement, log); log.push("caller"); await pending;
    assert.sameValue(holder.resource[Symbol.asyncDispose], replacement);
    assert.compareArray(log, ["body", "original", holder.resource, "caller", "end", holder.resource, "outside"]);
    await holder.resource[Symbol.asyncDispose]();
    assert.compareArray(log, ["body", "original", holder.resource, "caller", "end", holder.resource, "outside", "replacement", holder.resource]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
