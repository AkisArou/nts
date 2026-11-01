/*---
description: Control for factory-fresh-class-static-isolation; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-closures]
---*/
// Control: class values are factory records; instances are ordered plain objects and ancestry is checked by tags.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: number; value: CVValue; target: string; }
interface CVState { log: unknown[]; seen: CVItem[]; }
interface CVCtor { factory: (state: CVState, value: CVValue) => CVItem; count: number; tag: number; }
function cvMake(kind: number): CVCtor {
  const record: CVCtor = { count: 0, tag: kind, factory(state, value) { const before = record.count; state.log.push("static.count.before", kind, before); record.count = before + 1; const result: CVItem = { kind, value, target: "CVFresh" }; state.seen.push(result); state.log.push("construct", "CVFresh", kind, state, value, result.target); return result; } }; return record;
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
for (const input of cvInputs) {
  const choices: CVCtor[] = [cvMake(0), cvMake(1), cvMake(2)];
  for (let selected = 0; selected < choices.length; selected++) {
    const state: CVState = { log: [], seen: [] }; const Ctor: CVCtor = choices[selected];
    for (let candidate = 0; candidate < choices.length; candidate++) assert.sameValue(Object.is(Ctor, choices[candidate]), candidate === selected);
    const first = Ctor.factory(state, input), second = Ctor.factory(state, input);
    assert.sameValue(Object.is(first, second), false); assert.sameValue(state.seen.length, 2);
    const results = [first, second];
    for (let at = 0; at < results.length; at++) {
      const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
      const fields: [unknown, unknown][] = [[result.kind, selected], [result.value, input], [result.target, "CVFresh"]];
      for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
      for (let candidate = 0; candidate < choices.length; candidate++) assert.sameValue(result.kind === choices[candidate].tag, candidate === selected);
    }
    const expected: unknown[] = ["static.count.before", selected, 0, "construct", "CVFresh", selected, state, input, "CVFresh", "static.count.before", selected, 1, "construct", "CVFresh", selected, state, input, "CVFresh"];
    for (let candidate = 0; candidate < choices.length; candidate++) { const count = choices[candidate].count; state.log.push("static.count.after", candidate, count); const wanted = candidate <= selected ? 2 : 0; assert.sameValue(Object.is(count, wanted), true); assert.sameValue(typeof count, "number"); expected.push("static.count.after", candidate, wanted); }
    assert.compareArray(state.log, expected);
  }
}
