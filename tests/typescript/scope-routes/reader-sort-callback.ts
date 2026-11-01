/*---
description: A typed comparator reaches all five module binding kinds while retaining its arguments, effects and exact sorted order.
features: [ts-scope-route-readers, ts-modules, ts-unions, ts-objects, ts-arrays, ts-functions, ts-function-types]
flags: [module]
---*/
// Route: sort reads let, var, const-object, function and class bindings; node preserves each later value and its identity.
type ReaderValue = number | string | undefined | { id: number };
interface ReaderCell { value: ReaderValue; writes: number; }
type ReaderOperation = (state: ReaderState, value: ReaderValue) => ReaderValue;
type ReaderConstructor = new (state: ReaderState, value: ReaderValue) => { value: ReaderValue };
interface ReaderState { log: unknown[]; current: ReaderValue; previous: ReaderValue; cell: ReaderCell; operation: ReaderOperation; Box: ReaderConstructor; seenOperation: ReaderOperation | undefined; seenBox: ReaderConstructor | undefined; output: ReaderValue; }
interface ReaderEntry { state: ReaderState; value: ReaderValue; rank: number; }
function relayOperation(state: ReaderState, value: ReaderValue): ReaderValue { state.log.push("operation", value); return value; }
class TransferredBox { value: ReaderValue; constructor(state: ReaderState, value: ReaderValue) { this.value = value; state.log.push("constructor", value); } }
let current: ReaderValue = undefined; var previous: ReaderValue = "seed"; const cell: ReaderCell = { value: 1, writes: 0 };
function compare(left: ReaderEntry, right: ReaderEntry): number {
  const s = left.state, input = left.value; s.log.push("sort.arguments", left.rank, right.rank, input, right.value);
    const old = current, prior = previous; s.log.push("sort.read-let", old, "sort.read-var", prior);
    current = input; previous = old; s.log.push("sort.write-let", input, "sort.write-var", old);
    const held = cell; s.log.push("sort.read-const", held, held.value, held.writes); held.value = input; held.writes++; s.log.push("sort.write-field", input, held.writes);
    const operation = relayOperation, Box = TransferredBox; s.log.push("sort.read-function", operation, "sort.read-class", Box);
    s.seenOperation = operation; s.seenBox = Box; const result = new Box(s, operation(s, input)).value;
    s.output = result; s.log.push("sort.result", result); s.log.push("sort.order", left.rank - right.rank); return left.rank - right.rank;
}
const state: ReaderState = { log: [], current: undefined, previous: "seed", cell: cell, operation: relayOperation, Box: TransferredBox, seenOperation: undefined, seenBox: undefined, output: undefined };
const identity = { id: 7 }; const inputs: ReaderValue[] = [7, -0, NaN, 0.5, 2147483648, "", "é中", undefined, identity, 1, undefined];
let last: ReaderValue = undefined, beforeLast: ReaderValue = "seed", lastCell: ReaderValue = 1, turn = 0;
for (const input of inputs) {
  state.log.length = 0; turn++;
  const rows: ReaderEntry[] = [{ state, value: undefined, rank: 1 }, { state, value: input, rank: 0 }]; rows.sort(compare); const result = state.output;
  assert.compareArray([rows[0].rank, rows[1].rank], [0, 1]);
  const finalLet = current, finalVar = previous, finalCell = cell; state.log.push("driver.read", finalLet, finalVar, finalCell, finalCell.value, finalCell.writes);
  const checks: [unknown, unknown][] = [[result, input], [state.output, input], [finalLet, input], [finalVar, last], [finalCell, state.cell], [finalCell.value, input], [state.seenOperation, relayOperation], [state.seenBox, TransferredBox]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(finalCell.writes, turn);
  assert.compareArray(state.log, ["sort.arguments", 0, 1, input, undefined, "sort.read-let", last, "sort.read-var", beforeLast, "sort.write-let", input, "sort.write-var", last, "sort.read-const", state.cell, lastCell, turn - 1, "sort.write-field", input, turn, "sort.read-function", relayOperation, "sort.read-class", TransferredBox, "operation", input, "constructor", input, "sort.result", input, "sort.order", -1, "driver.read", input, last, state.cell, input, turn]);
  beforeLast = last; last = input; lastCell = input;
}
