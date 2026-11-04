/*---
description: "Control: A timer resolves a promise whose reaction schedules a field-held child callback; an already waiting same-delay peer fires before that child."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Class callback field route; a promise-created child waits behind the registered peer and retains the parent value. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:parent|reaction:parent|timer:peer|timer:child:parent|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class ReactionJob {
  callback: () => void = () => {};
  later(label: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.callback = () => { log.push("timer:" + label); resolve(label); };
      enqueue(this.callback, 1);
    });
  }
}
async function main(): Promise<void> {
  const route = new ReactionJob();
  const parent = route.later("parent"), peer = route.later("peer");
  const child = parent.then((value) => { log.push("reaction:" + value); return route.later("child:" + value); });
  const joined = Promise.all([peer, child]);
  log.push("sync");
  pending[0](); await parent; pending[1](); pending[2]();
  const values = await joined; log.push("after");
  assert.compareArray(values, ["peer", "child:parent"]);
  assert.compareArray(log, ["sync", "timer:parent", "reaction:parent", "timer:peer", "timer:child:parent", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
