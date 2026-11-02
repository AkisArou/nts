/*---
description: "Control for string-live-field-comparisons; A captured string-enum field is read afresh after each member assignment and narrowed by raw-string or enum comparison."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-interfaces, ts-narrowing, ts-literal-types, ts-closures, ts-arrow-functions, ts-function-types, ts-type-aliases, ts-unions]
---*/
// Two interface layouts feed a live closure; node observes every replacement, treats the named alias as ready, and logs only the matching member branch. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const TextState = Object.freeze({ Empty: "", Ready: "ready", Alias: "ready", Closed: "closed" }); type TextState = "" | "ready" | "closed";
interface StateCell { state: TextState; }
function watch(cell: StateCell, log: unknown[]): () => TextState {
  return () => {
    const value = cell.state;
    if (value === "ready") { const member: "ready" = value; log.push("ready", member); return member; }
    if (value === TextState.Empty) { const member: "" = value; log.push("empty", member); return member; }
    const member: "closed" = value; log.push("closed", member); return member;
  };
}
const inputs: TextState[] = [TextState.Empty, TextState.Ready, TextState.Alias, TextState.Closed], expected = ["", "ready", "ready", "closed"];
const wide = { padding: 7, state: TextState.Closed }, carriers: StateCell[] = [{ state: TextState.Empty }, wide];
for (const cell of carriers) {
  const log: unknown[] = [], read = watch(cell, log);
  for (let at = 0; at < inputs.length; at++) { cell.state = inputs[at]; same(cell.state, expected[at]); same(read(), expected[at]); }
  exact(log, ["empty", "", "ready", "ready", "ready", "ready", "closed", "closed"]); same(cell.state, "closed");
}
