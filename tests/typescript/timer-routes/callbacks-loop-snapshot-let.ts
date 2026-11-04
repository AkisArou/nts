/*---
description: "A timeout receives a registration-time argument beside a captured live let; each loop step preserves its old argument and its later binding write."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown]
flags: [async]
---*/
// A timeout receives a registration-time argument beside a captured live let; each loop step preserves its old argument and its later binding write.
// Node prints: sync|3:13|5:15|7:17|after
const log: string[] = [];
async function main(): Promise<void> {
  for (let index: number = 0; index < 3; index++) {
    let value: number = index * 2 + 3;
    const callback: (snapshot: number) => void = (snapshot) => { log.push(snapshot + ":" + value); };
    setTimeout(callback, 1, value);
    value += 10;
  }
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "3:13", "5:15", "7:17", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
