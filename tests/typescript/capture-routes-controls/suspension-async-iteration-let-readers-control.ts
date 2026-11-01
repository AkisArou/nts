/*---
description: Control for suspension-async-iteration-let-readers; the same stages read the binding directly.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-async-generators, ts-generators, ts-iteration, ts-arrays, ts-unions]
flags: [async]
---*/
// Control: remove the reader closure; direct reads use the same live binding and occur at the same points.
interface SuspendedPayload { marker: string; }
type SuspensionValue = number | string | boolean | undefined | bigint | SuspendedPayload | number[];
const objectValue: SuspendedPayload = { marker: "identity" }; const arrayValue: number[] = [1, 2];
const samples: { input: SuspensionValue; kind: string }[] = [
  { input: 1, kind: "number" }, { input: -0, kind: "number" }, { input: NaN, kind: "number" },
  { input: 0.5, kind: "number" }, { input: 2147483648, kind: "number" },
  { input: "", kind: "string" }, { input: "\u00e9", kind: "string" }, { input: "\u4e2d\ud83d\ude00", kind: "string" },
  { input: false, kind: "boolean" }, { input: true, kind: "boolean" },
  { input: undefined, kind: "undefined" }, { input: 9007199254740993n, kind: "bigint" },
  { input: objectValue, kind: "object" }, { input: arrayValue, kind: "object" }
];
interface IterationState { id: number; value: SuspensionValue; next: SuspensionValue; }
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
async function* iterationReaders(states: IterationState[], log: string[]): AsyncGenerator<{ state: IterationState }, void, void> {
  for (let state of states) {
    log.push("enter:" + state.id);
    log.push("await:" + state.id); await Promise.resolve(); log.push("yield:" + state.id); yield { state };
    state.value = state.next; log.push("write:" + state.id);
  }
}
async function main(): Promise<void> {
  for (const row of samples) {
    const states: IterationState[] = [{ id: 0, value: 1, next: row.input }, { id: 1, value: "start", next: "tail" }];
    const log: string[] = ["write:initial"]; const saved: { state: IterationState }[] = [];
    for await (const entry of iterationReaders(states, log)) {
      log.push("read:" + entry.state.id); captureCheck(entry.state.value, entry.state.id === 0 ? 1 : "start", entry.state.id === 0 ? "number" : "string"); saved.push(entry);
    }
    assert.sameValue(saved.length, 2); log.push("read:" + saved[0].state.id); captureCheck(saved[0].state.value, row.input, row.kind); log.push("read:" + saved[1].state.id); captureCheck(saved[1].state.value, "tail", "string");
    captureCheck(states[0].value, row.input, row.kind); captureCheck(states[1].value, "tail", "string");
    assert.compareArray(log, ["write:initial", "enter:0", "await:0", "yield:0", "read:0", "write:0", "enter:1", "await:1", "yield:1", "read:1", "write:1", "read:0", "read:1"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
