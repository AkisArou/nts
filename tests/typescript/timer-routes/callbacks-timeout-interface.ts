/*---
description: "A delivery interface dispatches to plain and timeout implementations; the timer implementation receives its own ordered arguments after the call returns."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-tuples, ts-iteration]
flags: [async]
---*/
// A delivery interface dispatches to plain and timeout implementations; the timer implementation receives its own ordered arguments after the call returns.
// Node prints: before|plain:13:a|called|joined|before|called|timed:103:a|joined|before|plain:6:b|called|joined|before|called|timed:96:b|joined
const log: string[] = [];
interface TimerArgumentDelivery { send(value: number, tag: string): Promise<void>; }
class PlainDelivery implements TimerArgumentDelivery {
  offset: number = 10;
  send(value: number, tag: string): Promise<void> { log.push("plain:" + (value + this.offset) + ":" + tag); return Promise.resolve(); }
}
class TimedDelivery implements TimerArgumentDelivery {
  padding: string = "padding"; offset: number = 100;
  send(value: number, tag: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const callback = (item: number, label: string): void => { log.push("timed:" + (item + this.offset) + ":" + label); resolve(); };
      setTimeout(callback, 1, value, tag);
    });
  }
}
async function main(): Promise<void> {
  const routes: TimerArgumentDelivery[] = [new PlainDelivery(), new TimedDelivery()];
  const inputs: [number, string][] = [[3, "a"], [-4, "b"]];
  for (const [value, tag] of inputs) for (const route of routes) {
    log.push("before"); const done = route.send(value, tag); log.push("called");
    await done; log.push("joined");
  }
  assert.compareArray(log, ["before", "plain:13:a", "called", "joined", "before", "called", "timed:103:a", "joined", "before", "plain:6:b", "called", "joined", "before", "called", "timed:96:b", "joined"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
