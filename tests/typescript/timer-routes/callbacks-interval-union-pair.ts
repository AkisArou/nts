/*---
description: "A discriminated callback union chooses number or string interval targets; every repeat receives the selected pair without exchanging values."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects]
flags: [async]
---*/
// A discriminated callback union chooses number or string interval targets; every repeat receives the selected pair without exchanging values.
// Node prints: number:sync|number:3:8|number:3:8|string:sync|string:左:右|string:左:右|after
const log: string[] = [];
type TimerAction = { kind: "number"; first: number; second: number; run: (first: number, second: number) => void } | { kind: "string"; first: string; second: string; run: (first: string, second: string) => void };
function repeat(route: TimerAction): Promise<void> {
  return new Promise<void>((resolve) => {
    let count = 0; let handle: number | undefined;
    const complete = (): void => { if (++count === 2) { clearInterval(handle); resolve(); } };
    if (route.kind === "number") {
      const tick = (first: number, second: number): void => { route.run(first, second); complete(); };
      handle = setInterval(tick, 1, route.first, route.second);
    } else {
      const tick = (first: string, second: string): void => { route.run(first, second); complete(); };
      handle = setInterval(tick, 1, route.first, route.second);
    }
  });
}
async function main(): Promise<void> {
  const first = repeat({ kind: "number", first: 3, second: 8, run: (left, right) => { log.push("number:" + left + ":" + right); } });
  log.push("number:sync");
  await first;
  const second = repeat({ kind: "string", first: "左", second: "右", run: (left, right) => { log.push("string:" + left + ":" + right); } });
  log.push("string:sync");
  await second;
  log.push("after");
  assert.compareArray(log, ["number:sync", "number:3:8", "number:3:8", "string:sync", "string:左:右", "string:左:右", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
