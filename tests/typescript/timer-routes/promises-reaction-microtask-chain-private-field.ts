/*---
description: "A timer promise reaction queues a promise job and microtask before another reaction schedules a private-field child; the waiting peer still precedes the child."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// Private callback field route; the full reaction chain schedules its child after the waiting peer. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:parent|reaction:parent|promise|micro|schedule|timer:peer|timer:child|after
const log: string[] = [];
class ReactionJob {
  #callback: () => void = () => {};
  later(label: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.#callback = () => { log.push("timer:" + label); resolve(label); };
      setTimeout(this.#callback, 1);
    });
  }
}
async function main(): Promise<void> {
  const route = new ReactionJob();
  const parent = route.later("parent"), peer = route.later("peer");
  const ready = parent.then((value) => new Promise<void>((resolve) => {
    log.push("reaction:" + value);
    Promise.resolve().then(() => { log.push("promise"); queueMicrotask(() => { log.push("micro"); resolve(); }); });
  }));
  const child = ready.then(() => { log.push("schedule"); return route.later("child"); });
  const joined = Promise.all([peer, child]);
  log.push("sync");
  const values = await joined; log.push("after");
  assert.compareArray(values, ["peer", "child"]);
  assert.compareArray(log, ["sync", "timer:parent", "reaction:parent", "promise", "micro", "schedule", "timer:peer", "timer:child", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
