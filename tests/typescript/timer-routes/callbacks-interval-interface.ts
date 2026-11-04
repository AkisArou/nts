/*---
description: "A delivery interface selects plain repetition or an interval; both implementations receive two ordered arguments on every call."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-tuples, ts-iteration]
flags: [async]
---*/
// A delivery interface selects plain repetition or an interval; both implementations receive two ordered arguments on every call.
// Node prints: before|plain:13:a|plain:13:a|called|joined|before|called|timed:103:a|timed:103:a|joined|before|plain:6:b|plain:6:b|called|joined|before|called|timed:96:b|timed:96:b|joined
const log: string[] = [];
interface TimerArgumentDelivery { send(value: number, tag: string): Promise<void>; }
class PlainDelivery implements TimerArgumentDelivery {
  offset: number = 10;
  send(value: number, tag: string): Promise<void> { for (let count = 0; count < 2; count++) log.push("plain:" + (value + this.offset) + ":" + tag); return Promise.resolve(); }
}
class TimedDelivery implements TimerArgumentDelivery {
  padding: string = "padding"; offset: number = 100;
  send(value: number, tag: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let count = 0;
      const callback = (item: number, label: string): void => { log.push("timed:" + (item + this.offset) + ":" + label); if (++count === 2) { clearInterval(handle); resolve(); } };
      const handle: number = setInterval(callback, 1, value, tag);
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
  assert.compareArray(log, ["before", "plain:13:a", "plain:13:a", "called", "joined", "before", "called", "timed:103:a", "timed:103:a", "joined", "before", "plain:6:b", "plain:6:b", "called", "joined", "before", "called", "timed:96:b", "timed:96:b", "joined"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
