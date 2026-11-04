/*---
description: "Control: A discriminated union selects either a generator source or its factory; node preserves the selected lazy route and its complete loop history."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-discriminated-unions, ts-unions, ts-narrowing, ts-type-aliases, ts-function-types, ts-arrow-functions, ts-objects, ts-numbers]
flags: [async]
---*/
// Synchronous control: A discriminated union selects either a generator source or its factory; node preserves the selected lazy route and its complete loop history.
const log: string[] = [];
type Route = { kind: "source"; source: Iterable<number> } | { kind: "factory"; create: () => Iterable<number> };
function* produce(base: number, count: number): Generator<number, void, undefined> {
  log.push("start:" + base);
  for (let index = 0; index < count; index++) { log.push("yield:" + index); yield base + index; log.push("resume:" + index); }
  log.push("finish:" + base);
}
async function consume(route: Route): Promise<number[]> {
  log.push("select:" + route.kind);
  const source = route.kind === "source" ? route.source : route.create(), seen: number[] = [];
  for (const pending of source) { const value = await pending; log.push("loop:" + seen.length); seen.push(value); }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    const routes: Route[] = [{ kind: "source", source: produce(2, count) }, { kind: "factory", create: () => { log.push("create"); return produce(9, count); } }];
    for (const route of routes) {
      log.length = 0; const seen = await consume(route), base = route.kind === "source" ? 2 : 9, expected = ["select:" + route.kind], wanted: number[] = [];
      if (route.kind === "factory") expected.push("create"); expected.push("start:" + base);
      for (let index = 0; index < count; index++) { expected.push("yield:" + index, "loop:" + index, "resume:" + index); wanted.push(base + index); }
      expected.push("finish:" + base, "after");
      assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(seen.length, count);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
