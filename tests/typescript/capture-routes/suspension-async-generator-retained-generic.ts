/*---
description: A generic reader survives async-generator completion and observes a later caller write.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-async-generators, ts-generators, ts-generics, ts-unions, ts-arrays]
flags: [async]
---*/
// Route: a generic async-generator parameter captured across await and yield; node observes every write in order.
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
interface AsyncCaptureState<T> { value: T; }
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
async function* keepAsync<T>(state: AsyncCaptureState<T>, next: T, log: string[]): AsyncGenerator<() => T, void, void> {
  const read: () => T = () => { log.push("read"); return state.value; };
  log.push("await:yield"); await Promise.resolve(); log.push("yield"); yield read;
  log.push("await:resume"); await Promise.resolve(); state.value = next; log.push("write:resume"); log.push("finish");
}
async function main(): Promise<void> {
  for (const row of samples) {
    const state: AsyncCaptureState<SuspensionValue> = { value: 1 }; const log: string[] = ["write:initial"];
    const iterator = keepAsync(state, row.input, log); const first = await iterator.next();
    if (first.done) throw new Error("expected a reader");
    const reader = first.value; captureCheck(reader(), 1, "number");
    assert.sameValue((await iterator.next()).done, true); captureCheck(reader(), row.input, row.kind);
    state.value = 0; log.push("write:after"); captureCheck(reader(), 0, "number"); captureCheck(state.value, 0, "number");
    assert.compareArray(log, ["write:initial", "await:yield", "yield", "read", "await:resume", "write:resume", "finish", "read", "write:after", "read"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
