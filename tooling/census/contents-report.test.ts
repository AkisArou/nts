import {strict as assert} from "node:assert";
import {test} from "node:test";
import {parseModule, render, repositoryRelative, summarize, type Allocation, type Case, type Module} from "./contents-report.ts";
const item: Case = {family: "programs", name: "control", config: "unused", entry: null};
function module(rows: Partial<Allocation>[] = []): Module {
  return {schema: 1, state: "PASS", preparation: "backend=c provider=ReferenceCounting", functions: 2,
    diagnostics: [], pruned_functions: 0, uncompiled_functions: 0,
    provider_visits: 20, budget_exhaustions: 0, rows: rows.map(r => ({function: "work", function_index: 0, value: 3,
      constructor: "nts_map_new", origin: "control", value_eligibility: "I32", reason: "closed numeric payload",
      fact: {tags: ["number"]}, key_eligibility: "Dynamic", key_reason: "unprovided", inspection_complete: true,
      recognized_writes: [], rejected_uses: [], ...r}))};
}
test("coverage and actual deltas count authoritative proofs, never recognized writes", () => {
  const old = module([{value_eligibility: "Dynamic", fact: {unknown: "open"}, reason: "open",
    recognized_writes: [{fact: {tags: ["number"]}}]}]);
  const before = summarize([item], [{case: item, state: "PASS", module: old}]);
  const after = summarize([item], [{case: item, state: "PASS", module: module([{}])}]);
  assert.equal(before.groups[0].candidates, 0);
  assert.equal(after.groups[0].candidates, 1);
  assert.match(render(after, before), /nts_map_new \| 1 \| 1 \| 0 \| 0 \| 1/);
});
test("budget and failed inputs stay observable", () => {
  const m = module([{value_eligibility: "Dynamic", reason: "budget", fact: {unknown: "budget"}, inspection_complete: false}]);
  m.budget_exhaustions = 1;
  const second = {...item, name: "invalid"};
  const s = summarize([item, second], [{case: item, state: "PASS", module: m}, {case: second, state: "FAIL", status: 1, error: "typecheck"}]);
  assert.equal(s.measured, 1); assert.equal(s.budget_exhaustions, 1);
  assert.equal(s.groups[0].dynamic, 1); assert.equal(s.groups[0].candidates, 0);
  assert.match(render(s), /1\/2 modules.*1 unmeasured/);
});
test("duplicate identities, partial populations and contradictory candidates fail", () => {
  assert.throws(() => parseModule(JSON.stringify(module([{}, {}]))), /duplicate allocation/);
  assert.throws(() => summarize([item], []), /incomplete/);
  assert.throws(() => parseModule(JSON.stringify(module([{fact: {unknown: "open"}}]))), /lacks a proof/);
  assert.throws(() => parseModule("warning\n{}"));
});
test("same-named functions remain distinct prepared identities", () => {
  const m = parseModule(JSON.stringify(module([{}, {function_index: 1}])));
  assert.equal(m.rows.length, 2);
});
test("precise string licences remain counted storage candidates", () => {
  const m = parseModule(JSON.stringify(module([{value_eligibility: "String", fact: {tags: ["string"]}}])));
  const s = summarize([item], [{case: item, state: "PASS", module: m}]);
  assert.equal(s.groups[0].candidates, 1);
});
test("comparison refuses a different corpus population", () => {
  const a = summarize([item], [{case: item, state: "PASS", module: module()}]);
  const other = {...item, name: "other"};
  const b = summarize([other], [{case: other, state: "PASS", module: module()}]);
  assert.throws(() => render(a, b), /different census populations/);
});
test("diagnostic alias events rank once per identity, not once per use", () => {
  const u = {category: "length", helper: null, argument: null, operation: 7, reason: "open", kind: "Length"};
  const s = summarize([item], [{case: item, state: "PASS", module: module([{
    value_eligibility: "Dynamic", reason: "open", fact: {unknown: "open"}, rejected_uses: [u, u]}])}]);
  assert.equal(s.rejected[0].affected, 1); assert.equal(s.rejected[0].sole, 1);
});
test("records from different worktree paths have the same bytes", () => {
  function recorded(tree: string) {
    const s = summarize([item], [{case: item, state: "FAIL", status: 1,
      error: `${tree}/tests/programs/invalid/src/main.ts:11:3\nfile://${tree}/src/main.ts`}]);
    return repositoryRelative(s, tree);
  }
  const a = recorded("/one/tree"), b = recorded("/other/tree");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(render(a), render(b));
  assert.match(a.failures[0].error!, /^tests\/programs\/invalid\/src\/main.ts:11:3\nsrc\/main.ts$/);
});
test("worker completion order cannot change the record", () => {
  const second = {...item, name: "second"};
  const rows = [{case: item, state: "PASS", module: module([{}])},
    {case: second, state: "PASS", module: module([{value_eligibility: "Optional<Bool>", fact: {tags: ["boolean", "undefined"]}}])}];
  assert.equal(JSON.stringify(summarize([item, second], rows)),
    JSON.stringify(summarize([item, second], [...rows].reverse())));
});
