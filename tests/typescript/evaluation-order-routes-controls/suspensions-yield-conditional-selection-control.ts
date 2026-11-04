/*---
description: "Control for suspensions-yield-conditional-selection; A conditional containing yield keeps its chosen branch across suspension and never enters the skipped branch."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-tuples, ts-destructuring, ts-objects, ts-typeof-operator]
---*/
// An interface boolean carries a conditional yield; node either completes without yielding or resumes the already chosen branch after the caller reverses its test. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
interface Route { test: boolean; value: number; }
function enabled(route: Route): boolean { log.push(`test:${route.test}`); return route.test; }
function tail(route: Route): number { log.push(`tail:${route.value}`); return route.value; }
function fallback(route: Route): number { log.push(`fallback:${route.value}`); return route.value - 20; }
function pause(): number { log.push("pause"); return 7; }
function* choose(route: Route): Generator<number, number, number> {
  log.push("start");
  const selected = enabled(route);
  if (selected) {
    const outgoing = pause();
    const incoming = yield outgoing;
    const last = tail(route);
    return incoming + last;
  }
  const result = fallback(route);
  return result;
}
const rows: [boolean, number][] = [[true, 3], [true, -2], [false, 3], [false, -2]];
for (const [selected, sent] of rows) {
  const route: Route = { test: selected, value: 10 }; log.length = 0; const iterator = choose(route); assert.compareArray(log, []); const first = iterator.next();
  const expected = ["start", `test:${selected}`, selected ? "pause" : "fallback:10"];
  assert.compareArray(log, expected); assert.sameValue(first.value, selected ? 7 : -10); assert.sameValue(first.done, !selected);
  log.push("mutate"); route.test = !selected; route.value = 40;
  const second = iterator.next(sent); const finished = iterator.next(999); expected.push("mutate"); if (selected) expected.push("tail:40");
  assert.compareArray(log, expected);
  assert.sameValue(second.value, selected ? sent + 40 : undefined); assert.sameValue(typeof second.value, selected ? "number" : "undefined"); assert.sameValue(second.done, true);
  assert.sameValue(route.test, !selected); assert.sameValue(route.value, 40); assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
