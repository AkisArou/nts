/*---
description: "Control for suspensions-yield-compound-private; Compound private-field subtraction retains the branded receiver and old number across yield."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-generators, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-destructuring, ts-typeof-operator]
---*/
// A class method and declared holder route #value -= across yield; node keeps the original private read while caller writes a new value and selects another instance. The control saves each evaluated part and yields in its own statement.
const log: string[] = [];
class Cell {
  id: string; #value: number;
  constructor(id: string, value: number) { log.push(`new:${id}`); this.id = id; this.#value = value; }
  write(value: number): void { log.push(`write:${this.id}:${value}`); this.#value = value; }
  read(): number { log.push(`read:${this.id}`); return this.#value; }
  *update(route: Holder): Generator<number, number, number> {
    log.push("start");
    const receiver = target(route);
    const left = receiver.#value;
    const outgoing = pause();
    const incoming = yield outgoing;
    const result = left - incoming;
    receiver.#value = result;
    return result;
  }
}
class Holder { current: Cell; constructor(current: Cell) { log.push("holder:new"); this.current = current; } }
function target(route: Holder): Cell { log.push(`target:${route.current.id}`); return route.current; }
function pause(): number { log.push("pause"); return 7; }
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, sent] of rows) {
  const cell = new Cell("first", initial), other = new Cell("other", 90), route = new Holder(cell);
  log.length = 0; const iterator = cell.update(route); assert.compareArray(log, []); const first = iterator.next();
  assert.compareArray(log, ["start", "target:first", "pause"]); assert.sameValue(first.value, 7); assert.sameValue(first.done, false);
  log.push("mutate"); cell.write(100); route.current = other;
  const second = iterator.next(sent); const finished = iterator.next(999); const left = cell.read(); const right = other.read();
  assert.compareArray(log, ["start", "target:first", "pause", "mutate", "write:first:100", "read:first", "read:other"]);
  assert.sameValue(second.value, initial - sent); assert.sameValue(typeof second.value, "number"); assert.sameValue(second.done, true);
  assert.sameValue(left, initial - sent); assert.sameValue(right, 90); assert.sameValue(route.current, other);
  assert.sameValue(finished.value, undefined); assert.sameValue(finished.done, true);
}
