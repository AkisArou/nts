/*---
description: "Control: Interval extra-argument pairs cross a generic helper at number and string; both repetitions receive the original ordered pair."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics]
flags: [async]
---*/
// Control: Interval extra-argument pairs cross a generic helper at number and string; both repetitions receive the original ordered pair.
// Node prints: number:sync|number:3:8|number:3:8|string:sync|string:左:右|string:左:右|after
const log: string[] = [];
const pending: (() => void)[] = [];
function keep(callback: () => void): number { pending.push(callback); return 0; }
function forget(handle: number | undefined): void {}
function repeat<T>(first: T, second: T, sink: (first: T, second: T) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let count = 0;
    const tick = (left: T, right: T): void => { sink(left, right); if (++count === 2) { forget(handle); resolve(); } };
    const handle: number = keep(() => tick(first, second));
  });
}
async function main(): Promise<void> {
  const first = repeat<number>(3, 8, (left, right) => { log.push("number:" + left + ":" + right); });
  log.push("number:sync");
  pending[0](); pending[0]();
  await first;
  const second = repeat<string>("左", "右", (left, right) => { log.push("string:" + left + ":" + right); });
  log.push("string:sync");
  pending[1](); pending[1]();
  await second;
  log.push("after");
  assert.compareArray(log, ["number:sync", "number:3:8", "number:3:8", "string:sync", "string:左:右", "string:左:右", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
