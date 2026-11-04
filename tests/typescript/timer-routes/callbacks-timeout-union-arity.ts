/*---
description: "A discriminated union of one-argument and three-argument callbacks preserves each selected timeout signature and supplied value sequence."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-iteration]
flags: [async]
---*/
// A discriminated union of one-argument and three-argument callbacks preserves each selected timeout signature and supplied value sequence.
// Node prints: sync|single:7|triple:左:5:右|single:-2|triple::9:中|after
const log: string[] = [];
type TimerAction = { kind: "single"; value: number; run: (value: number) => void } | { kind: "triple"; first: string; middle: number; last: string; run: (first: string, middle: number, last: string) => void };
function schedule(route: TimerAction): void {
  if (route.kind === "single") setTimeout(route.run, 1, route.value);
  else setTimeout(route.run, 1, route.first, route.middle, route.last);
}
async function main(): Promise<void> {
  const single = (value: number): void => { log.push("single:" + value); };
  const triple = (first: string, middle: number, last: string): void => { log.push("triple:" + first + ":" + middle + ":" + last); };
  const routes: TimerAction[] = [
    { kind: "single", value: 7, run: single }, { kind: "triple", first: "左", middle: 5, last: "右", run: triple },
    { kind: "single", value: -2, run: single }, { kind: "triple", first: "", middle: 9, last: "中", run: triple }
  ];
  for (const route of routes) schedule(route);
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "single:7", "triple:左:5:右", "single:-2", "triple::9:中", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
