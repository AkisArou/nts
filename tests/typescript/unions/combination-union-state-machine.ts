/*---
description: A discriminated union of classes and literals drives a state machine through narrowing, type guards and an exhaustive switch.
features: [ts-unions, ts-narrowing, ts-discriminated-unions, ts-class, ts-type-guards, ts-never]
---*/
class Loading {
  readonly kind = "loading";
  constructor(readonly since: number) {}
}
type State = Loading | { kind: "done"; data: string[] } | { kind: "failed"; reason: unknown };
function isFinished(state: State): state is Exclude<State, Loading> {
  return state.kind !== "loading";
}
function render(state: State): string {
  switch (state.kind) {
    case "loading":
      return `since ${state.since}`;
    case "done":
      return state.data.join(",");
    case "failed":
      return state.reason instanceof Error ? state.reason.message : "unknown";
    default: {
      const never: never = state;
      return never;
    }
  }
}
const states: State[] = [new Loading(3), { kind: "done", data: ["a", "b"] }, { kind: "failed", reason: new Error("boom") }];
assert.sameValue(states.map(render).join(" | "), "since 3 | a,b | boom");
assert.sameValue(states.filter(isFinished).length, 2);
