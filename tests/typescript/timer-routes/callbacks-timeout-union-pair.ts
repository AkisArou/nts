/*---
description: "A discriminated union selects number or string callbacks before timeout registration; both extra arguments reach the selected function in order."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-iteration]
flags: [async]
---*/
// A discriminated union selects number or string callbacks before timeout registration; both extra arguments reach the selected function in order.
// Node prints: sync|number:3:8|string:左:右|number:-4:12|string::中|after
const log: string[] = [];
type TimerAction = { kind: "number"; first: number; second: number; run: (first: number, second: number) => void } | { kind: "string"; first: string; second: string; run: (first: string, second: string) => void };
function schedule(route: TimerAction): void {
  if (route.kind === "number") setTimeout(route.run, 1, route.first, route.second);
  else setTimeout(route.run, 1, route.first, route.second);
}
async function main(): Promise<void> {
  const numberSink = (first: number, second: number): void => { log.push("number:" + first + ":" + second); };
  const stringSink = (first: string, second: string): void => { log.push("string:" + first + ":" + second); };
  const routes: TimerAction[] = [
    { kind: "number", first: 3, second: 8, run: numberSink }, { kind: "string", first: "左", second: "右", run: stringSink },
    { kind: "number", first: -4, second: 12, run: numberSink }, { kind: "string", first: "", second: "中", run: stringSink }
  ];
  for (const route of routes) schedule(route);
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "number:3:8", "string:左:右", "number:-4:12", "string::中", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
