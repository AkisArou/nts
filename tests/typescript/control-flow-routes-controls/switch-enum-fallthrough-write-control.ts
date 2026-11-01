/*---
description: "Control for switch-enum-fallthrough-write; Reassigning an enum discriminant in a selected arm does not redirect its fallthrough."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-enum, ts-never, ts-errors]
---*/
// A numeric enum chooses the entry; node logs Start then Middle even after phase becomes End, preserving the union payload and final phase. The control selects arms with explicit ifs and fallthrough state.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
enum SwitchPhase { Start = -1, Middle = 0, End = 2 }
const phases: SwitchPhase[] = [SwitchPhase.Start, SwitchPhase.Middle, SwitchPhase.End];
function route(phase: SwitchPhase, input: SwitchValue, log: unknown[]): { value: SwitchValue; phase: SwitchPhase } {
  let result: SwitchValue = other;
  let falling = false;
  if (phase === SwitchPhase.Start) { log.push("start", phase, input); phase = SwitchPhase.End; falling = true; }
  if (falling || phase === SwitchPhase.Middle) { log.push("middle", phase, input); result = input; }
  else if (phase === SwitchPhase.End) { log.push("end", phase, input); result = marker; }
  else { const impossible: never = phase; log.push("impossible", impossible); throw new Test262Error(String(impossible)); }
  log.push("exit", result, phase); return { value: result, phase };
}
for (const input of inputs) for (const phase of phases) {
  const log: unknown[] = [], expected: unknown[] = [], result = route(phase, input, log);
  const answer = phase === SwitchPhase.End ? marker : input, finalPhase = phase === SwitchPhase.Start ? SwitchPhase.End : phase;
  if (phase === SwitchPhase.Start) expected.push("start", -1, input);
  if (phase === SwitchPhase.End) expected.push("end", 2, input); else expected.push("middle", finalPhase, input);
  expected.push("exit", answer, finalPhase);
  same(result.value, answer); same(result.phase, finalPhase); assert.compareArray(log, expected);
}
