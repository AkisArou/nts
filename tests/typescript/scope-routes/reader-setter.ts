/*---
description: A setter receiving a typed context record observes and updates current module bindings on every property write.
features: [ts-scope-route-readers, ts-modules, ts-unions, ts-objects, ts-class, ts-accessors]
flags: [module]
---*/
// Route: set reads let, var, const-object, function and class bindings; node preserves each later value and its identity.
type ReaderValue = number | string | undefined | { id: number };
interface ReaderCell { value: ReaderValue; writes: number; }
type ReaderOperation = (state: ReaderState, value: ReaderValue) => ReaderValue;
type ReaderConstructor = new (state: ReaderState, value: ReaderValue) => { value: ReaderValue };
interface ReaderState { log: unknown[]; current: ReaderValue; previous: ReaderValue; cell: ReaderCell; operation: ReaderOperation; Box: ReaderConstructor; seenOperation: ReaderOperation | undefined; seenBox: ReaderConstructor | undefined; output: ReaderValue; }
interface ReaderEntry { state: ReaderState; value: ReaderValue; rank: number; }
function relayOperation(state: ReaderState, value: ReaderValue): ReaderValue { state.log.push("operation", value); return value; }
class TransferredBox { value: ReaderValue; constructor(state: ReaderState, value: ReaderValue) { this.value = value; state.log.push("constructor", value); } }
let current: ReaderValue = undefined; var previous: ReaderValue = "seed"; const cell: ReaderCell = { value: 1, writes: 0 };
class ScopeReader { set entry(entry: ReaderEntry) { const s = entry.state, input = entry.value;
    const old = current, prior = previous; s.log.push("set.read-let", old, "set.read-var", prior);
    current = input; previous = old; s.log.push("set.write-let", input, "set.write-var", old);
    const held = cell; s.log.push("set.read-const", held, held.value, held.writes); held.value = input; held.writes++; s.log.push("set.write-field", input, held.writes);
    const operation = relayOperation, Box = TransferredBox; s.log.push("set.read-function", operation, "set.read-class", Box);
    s.seenOperation = operation; s.seenBox = Box; const result = new Box(s, operation(s, input)).value;
    s.output = result; s.log.push("set.result", result);
} }
const state: ReaderState = { log: [], current: undefined, previous: "seed", cell: cell, operation: relayOperation, Box: TransferredBox, seenOperation: undefined, seenBox: undefined, output: undefined };
const reader = new ScopeReader();
const identity = { id: 7 }; const inputs: ReaderValue[] = [7, -0, NaN, 0.5, 2147483648, "", "é中", undefined, identity, 1, undefined];
let last: ReaderValue = undefined, beforeLast: ReaderValue = "seed", lastCell: ReaderValue = 1, turn = 0;
for (const input of inputs) {
  state.log.length = 0; turn++;
  reader.entry = { state, value: input, rank: 0 }; const result = state.output;
  const finalLet = current, finalVar = previous, finalCell = cell; state.log.push("driver.read", finalLet, finalVar, finalCell, finalCell.value, finalCell.writes);
  const checks: [unknown, unknown][] = [[result, input], [state.output, input], [finalLet, input], [finalVar, last], [finalCell, state.cell], [finalCell.value, input], [state.seenOperation, relayOperation], [state.seenBox, TransferredBox]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(finalCell.writes, turn);
  assert.compareArray(state.log, ["set.read-let", last, "set.read-var", beforeLast, "set.write-let", input, "set.write-var", last, "set.read-const", state.cell, lastCell, turn - 1, "set.write-field", input, turn, "set.read-function", relayOperation, "set.read-class", TransferredBox, "operation", input, "constructor", input, "set.result", input, "driver.read", input, last, state.cell, input, turn]);
  beforeLast = last; last = input; lastCell = input;
}
