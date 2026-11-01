/*---
description: "Control for stateful-shared-alternating-exec-test; Alternating exec and test routes share one global or sticky expression across field, closure, parameter and generic views."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// A generic identity stores the expression in an interface field; an exec parameter and a retained test closure alternate, and node exposes every shared-state transition. The control uses a fresh literal with an independent planned lastIndex before each call, repeated twice.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type CallPlan = { starts: number[]; expected: unknown[]; count: number };
type SharedRow = { text: string; globalPlan: CallPlan; stickyPlan: CallPlan };
const rows: SharedRow[] = [
  { text: "", globalPlan: { starts: [0, 0, 0, 0], expected: ["miss", 0, "test", false, 0, "miss", 0, "test", false, 0], count: 0 }, stickyPlan: { starts: [0, 0, 0, 0], expected: ["miss", 0, "test", false, 0, "miss", 0, "test", false, 0], count: 0 } },
  { text: "aaa", globalPlan: { starts: [0, 1, 2, 3], expected: ["hit", 0, 1, "a", 1, "test", true, 2, "hit", 2, 1, "a", 3, "test", false, 0], count: 3 }, stickyPlan: { starts: [0, 1, 2, 3], expected: ["hit", 0, 1, "a", 1, "test", true, 2, "hit", 2, 1, "a", 3, "test", false, 0], count: 3 } },
  { text: "aba", globalPlan: { starts: [0, 1, 3, 0], expected: ["hit", 0, 1, "a", 1, "test", true, 3, "miss", 0, "test", true, 1], count: 3 }, stickyPlan: { starts: [0, 1, 0, 1], expected: ["hit", 0, 1, "a", 1, "test", false, 0, "hit", 0, 1, "a", 1, "test", false, 0], count: 2 } },
  { text: "\ud83d\ude00a", globalPlan: { starts: [0, 3, 0, 3], expected: ["hit", 2, 1, "a", 3, "test", false, 0, "hit", 2, 1, "a", 3, "test", false, 0], count: 2 }, stickyPlan: { starts: [0, 0, 0, 0], expected: ["miss", 0, "test", false, 0, "miss", 0, "test", false, 0], count: 0 } },
  { text: "a\u0301a", globalPlan: { starts: [0, 1, 3, 0], expected: ["hit", 0, 1, "a", 1, "test", true, 3, "miss", 0, "test", true, 1], count: 3 }, stickyPlan: { starts: [0, 1, 0, 1], expected: ["hit", 0, 1, "a", 1, "test", false, 0, "hit", 0, 1, "a", 1, "test", false, 0], count: 2 } },
  { text: "a\na", globalPlan: { starts: [0, 1, 3, 0], expected: ["hit", 0, 1, "a", 1, "test", true, 3, "miss", 0, "test", true, 1], count: 3 }, stickyPlan: { starts: [0, 1, 0, 1], expected: ["hit", 0, 1, "a", 1, "test", false, 0, "hit", 0, 1, "a", 1, "test", false, 0], count: 2 } },
  { text: "a\r\na", globalPlan: { starts: [0, 1, 4, 0], expected: ["hit", 0, 1, "a", 1, "test", true, 4, "miss", 0, "test", true, 1], count: 3 }, stickyPlan: { starts: [0, 1, 0, 1], expected: ["hit", 0, 1, "a", 1, "test", false, 0, "hit", 0, 1, "a", 1, "test", false, 0], count: 2 } },
  { text: "a\u2028a", globalPlan: { starts: [0, 1, 3, 0], expected: ["hit", 0, 1, "a", 1, "test", true, 3, "miss", 0, "test", true, 1], count: 3 }, stickyPlan: { starts: [0, 1, 0, 1], expected: ["hit", 0, 1, "a", 1, "test", false, 0, "hit", 0, 1, "a", 1, "test", false, 0], count: 2 } },
  { text: "xyz", globalPlan: { starts: [0, 0, 0, 0], expected: ["miss", 0, "test", false, 0, "miss", 0, "test", false, 0], count: 0 }, stickyPlan: { starts: [0, 0, 0, 0], expected: ["miss", 0, "test", false, 0, "miss", 0, "test", false, 0], count: 0 } }
];
function inspect(row: SharedRow): void {
  for (const sticky of [false, true]) for (const repeat of [0, 1]) {
    const plan = sticky ? row.stickyPlan : row.globalPlan, log: unknown[] = []; let count = 0;
    for (let i = 0; i < 4; i++) {
      const direct = sticky ? /a/y : /a/g; direct.lastIndex = plan.starts[i];
      if (i % 2 === 0) { const result = direct.exec(row.text); record(result, row.text, direct.lastIndex, log); if (result !== null) count++; }
      else { const result = direct.test(row.text); log.push("test", result, direct.lastIndex); if (result) count++; }
    }
    same(count, plan.count); check(log, plan.expected);
  }
}
for (const row of rows) inspect(row);
