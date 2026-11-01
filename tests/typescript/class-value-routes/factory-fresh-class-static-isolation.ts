/*---
description: Repeated calls to one typed factory produce distinct class identities and independent static counters.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-closures]
---*/
// Route: cvMake returns a fresh CVFresh constructor on each call; node separates all three class identities, instance tests and static counts.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: number; value: CVValue; target: string; }
interface CVState { log: unknown[]; seen: CVItem[]; }
interface CVCtor { new (state: CVState, value: CVValue): CVItem; count: number; }
function cvMake(kind: number): CVCtor {
  return class CVFresh { static count: number = 0; kind: number; value: CVValue; target: string;
    constructor(state: CVState, value: CVValue) { const before = CVFresh.count; state.log.push("static.count.before", kind, before); CVFresh.count = before + 1; this.kind = kind; this.value = value; this.target = new.target.name; state.seen.push(this); state.log.push("construct", "CVFresh", kind, state, value, this.target); }
  };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
for (const input of cvInputs) {
  const choices: CVCtor[] = [cvMake(0), cvMake(1), cvMake(2)];
  for (let selected = 0; selected < choices.length; selected++) {
    const state: CVState = { log: [], seen: [] }; const Ctor: CVCtor = choices[selected];
    for (let candidate = 0; candidate < choices.length; candidate++) assert.sameValue(Object.is(Ctor, choices[candidate]), candidate === selected);
    const first = new Ctor(state, input), second = new Ctor(state, input);
    assert.sameValue(Object.is(first, second), false); assert.sameValue(state.seen.length, 2);
    const results = [first, second];
    for (let at = 0; at < results.length; at++) {
      const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
      const fields: [unknown, unknown][] = [[result.kind, selected], [result.value, input], [result.target, "CVFresh"]];
      for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
      for (let candidate = 0; candidate < choices.length; candidate++) assert.sameValue(result instanceof choices[candidate], candidate === selected);
    }
    const expected: unknown[] = ["static.count.before", selected, 0, "construct", "CVFresh", selected, state, input, "CVFresh", "static.count.before", selected, 1, "construct", "CVFresh", selected, state, input, "CVFresh"];
    for (let candidate = 0; candidate < choices.length; candidate++) { const count = choices[candidate].count; state.log.push("static.count.after", candidate, count); const wanted = candidate <= selected ? 2 : 0; assert.sameValue(Object.is(count, wanted), true); assert.sameValue(typeof count, "number"); expected.push("static.count.after", candidate, wanted); }
    assert.compareArray(state.log, expected);
  }
}
