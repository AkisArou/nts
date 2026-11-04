/*---
description: Control: Comma observes the changed final value and stops at a throwing middle operand.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-generics, ts-generic-constraints, ts-interfaces, ts-accessors, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-expressions, ts-errors, ts-numbers]
---*/
// Comma through a generic interface; node keeps the first getter, the intervening write, then the live final read.
const log: string[] = [];
interface Source { readonly first: number; change(): number; readonly last: number; }
function sequence<T extends Source>(source: T): number {
  log.push("sequence");
  const first = source.first;
  const receiver = source;
  const change = receiver.change;
  const middle = change.call(receiver);
  const last = source.last;
  return last;
}
for (const fail of [false, true]) {
  let state = 1;
  const source: Source = {
    get first(): number { log.push("first:" + state); state = 2; return 1; },
    change(): number { log.push("change:" + state); state = 9; if (fail) throw new RangeError("middle"); return 4; },
    get last(): number { log.push("last:" + state); return state; }
  };
  function run(): number { log.push("run"); return sequence(source); }
  log.length = 0;
  if (fail) {
    assert.throws(RangeError, run);
    assert.compareArray(log, ["run", "sequence", "first:1", "change:2"]);
  } else {
    const result = run();
    assert.compareArray(log, ["run", "sequence", "first:1", "change:2", "last:9"]);
    assert.sameValue(result, 9);
  }
  assert.sameValue(state, 9);
}
