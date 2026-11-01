/*---
description: Declared field initializers directly read and update module bindings in order before invoking the captured function and constructor.
features: [ts-scope-route-readers, ts-modules, ts-unions, ts-objects, ts-class, ts-class-fields]
flags: [module]
---*/
// Route: field reads let, var, const-object, function and class bindings; node preserves each later value and its identity.
type ReaderValue = number | string | undefined | { id: number };
interface ReaderCell { value: ReaderValue; writes: number; }
type ReaderOperation = (state: ReaderState, value: ReaderValue) => ReaderValue;
type ReaderConstructor = new (state: ReaderState, value: ReaderValue) => { value: ReaderValue };
interface ReaderState { log: unknown[]; current: ReaderValue; previous: ReaderValue; cell: ReaderCell; operation: ReaderOperation; Box: ReaderConstructor; seenOperation: ReaderOperation | undefined; seenBox: ReaderConstructor | undefined; output: ReaderValue; }
interface ReaderEntry { state: ReaderState; value: ReaderValue; rank: number; }
function relayOperation(state: ReaderState, value: ReaderValue): ReaderValue { state.log.push("operation", value); return value; }
class TransferredBox { value: ReaderValue; constructor(state: ReaderState, value: ReaderValue) { this.value = value; state.log.push("constructor", value); } }
let current: ReaderValue = undefined; var previous: ReaderValue = "seed"; const cell: ReaderCell = { value: 1, writes: 0 };
function run(s: ReaderState, input: ReaderValue): ReaderValue {
  class Loaded {
    old: ReaderValue = current; prior: ReaderValue = previous;
    readLog: number = s.log.push("field.read-let", this.old, "field.read-var", this.prior);
    written: ReaderValue = (current = input); previousWritten: ReaderValue = (previous = this.old);
    writeLog: number = s.log.push("field.write-let", input, "field.write-var", this.old);
    held: ReaderCell = cell;
    heldLog: number = s.log.push("field.read-const", this.held, this.held.value, this.held.writes);
    fieldValue: ReaderValue = (this.held.value = input); fieldWrites: number = this.held.writes++;
    fieldLog: number = s.log.push("field.write-field", input, this.held.writes);
    operation: ReaderOperation = relayOperation; Box: ReaderConstructor = TransferredBox;
    targetLog: number = s.log.push("field.read-function", this.operation, "field.read-class", this.Box);
    seenOperation: ReaderOperation = (s.seenOperation = this.operation); seenBox: ReaderConstructor = (s.seenBox = this.Box);
    result: ReaderValue = new this.Box(s, this.operation(s, input)).value;
    output: ReaderValue = (s.output = this.result);
    resultLog: number = s.log.push("field.result", this.result);
  }
  return new Loaded().result;
}
const state: ReaderState = { log: [], current: undefined, previous: "seed", cell: cell, operation: relayOperation, Box: TransferredBox, seenOperation: undefined, seenBox: undefined, output: undefined };
const identity = { id: 7 }; const inputs: ReaderValue[] = [7, -0, NaN, 0.5, 2147483648, "", "é中", undefined, identity, 1, undefined];
let last: ReaderValue = undefined, beforeLast: ReaderValue = "seed", lastCell: ReaderValue = 1, turn = 0;
for (const input of inputs) {
  state.log.length = 0; turn++;
  const result = run(state, input);
  const finalLet = current, finalVar = previous, finalCell = cell; state.log.push("driver.read", finalLet, finalVar, finalCell, finalCell.value, finalCell.writes);
  const checks: [unknown, unknown][] = [[result, input], [state.output, input], [finalLet, input], [finalVar, last], [finalCell, state.cell], [finalCell.value, input], [state.seenOperation, relayOperation], [state.seenBox, TransferredBox]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(finalCell.writes, turn);
  assert.compareArray(state.log, ["field.read-let", last, "field.read-var", beforeLast, "field.write-let", input, "field.write-var", last, "field.read-const", state.cell, lastCell, turn - 1, "field.write-field", input, turn, "field.read-function", relayOperation, "field.read-class", TransferredBox, "operation", input, "constructor", input, "field.result", input, "driver.read", input, last, state.cell, input, turn]);
  beforeLast = last; last = input; lastCell = input;
}
