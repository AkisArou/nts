/*---
description: Explicit local-state control for a typed promise reaction reaches all five module binding kinds after attachment and preserves each later settlement value.
features: [ts-scope-route-readers, ts-modules, ts-unions, ts-objects, ts-async, ts-functions, ts-function-types]
flags: [module, async]
---*/
// Control: each reader receives local state; function and constructor handles are fields, with no module values read inside bodies.
type ReaderValue = number | string | undefined | { id: number };
interface ReaderCell { value: ReaderValue; writes: number; }
type ReaderOperation = (state: ReaderState, value: ReaderValue) => ReaderValue;
type ReaderConstructor = new (state: ReaderState, value: ReaderValue) => { value: ReaderValue };
interface ReaderState { log: unknown[]; current: ReaderValue; previous: ReaderValue; cell: ReaderCell; operation: ReaderOperation; Box: ReaderConstructor; seenOperation: ReaderOperation | undefined; seenBox: ReaderConstructor | undefined; output: ReaderValue; }
interface ReaderEntry { state: ReaderState; value: ReaderValue; rank: number; }
function relayOperation(state: ReaderState, value: ReaderValue): ReaderValue { state.log.push("operation", value); return value; }
class TransferredBox { value: ReaderValue; constructor(state: ReaderState, value: ReaderValue) { this.value = value; state.log.push("constructor", value); } }
function visit(entry: ReaderEntry): ReaderValue { const s = entry.state, input = entry.value;
    const old = s.current, prior = s.previous; s.log.push("then.read-let", old, "then.read-var", prior);
    s.current = input; s.previous = old; s.log.push("then.write-let", input, "then.write-var", old);
    const held = s.cell; s.log.push("then.read-const", held, held.value, held.writes); held.value = input; held.writes++; s.log.push("then.write-field", input, held.writes);
    const operation = s.operation, Box = s.Box; s.log.push("then.read-function", operation, "then.read-class", Box);
    s.seenOperation = operation; s.seenBox = Box; const result = new Box(s, operation(s, input)).value;
    s.output = result; s.log.push("then.result", result); return result;
}
const state: ReaderState = { log: [], current: undefined, previous: "seed", cell: { value: 1, writes: 0 }, operation: relayOperation, Box: TransferredBox, seenOperation: undefined, seenBox: undefined, output: undefined };
const identity = { id: 7 }; const inputs: ReaderValue[] = [7, -0, NaN, 0.5, 2147483648, "", "é中", undefined, identity, 1, undefined];
let last: ReaderValue = undefined, beforeLast: ReaderValue = "seed", lastCell: ReaderValue = 1, turn = 0;
try {
for (const input of inputs) {
  state.log.length = 0; turn++;
  const pending = Promise.resolve({ state, value: input, rank: 0 }).then(visit); state.log.push("then.attached", input);
  const result = await pending; state.log.push("then.resumed", result);
  const finalLet = state.current, finalVar = state.previous, finalCell = state.cell; state.log.push("driver.read", finalLet, finalVar, finalCell, finalCell.value, finalCell.writes);
  const checks: [unknown, unknown][] = [[result, input], [state.output, input], [finalLet, input], [finalVar, last], [finalCell, state.cell], [finalCell.value, input], [state.seenOperation, relayOperation], [state.seenBox, TransferredBox]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(finalCell.writes, turn);
  assert.compareArray(state.log, ["then.attached", input, "then.read-let", last, "then.read-var", beforeLast, "then.write-let", input, "then.write-var", last, "then.read-const", state.cell, lastCell, turn - 1, "then.write-field", input, turn, "then.read-function", relayOperation, "then.read-class", TransferredBox, "operation", input, "constructor", input, "then.result", input, "then.resumed", input, "driver.read", input, last, state.cell, input, turn]);
  beforeLast = last; last = input; lastCell = input;
}
  $DONE();
} catch (error: unknown) { $DONE(error instanceof Error ? error : new Error(String(error))); }
