/*---
description: Destructuring the discriminant and the payload still narrows the payload by the discriminant.
features: [ts-unions, ts-narrowing, ts-discriminated-unions, ts-destructuring]
---*/
type Action = { type: "add"; amount: number } | { type: "rename"; label: string };
function apply(state: { total: number; label: string }, { type, ...rest }: Action): string {
  if (type === "add") return `${state.label}:${state.total + (rest as { amount: number }).amount}`;
  return `${(rest as { label: string }).label}:${state.total}`;
}
const state = { total: 1, label: "s" };
assert.sameValue(apply(state, { type: "add", amount: 4 }), "s:5");
assert.sameValue(apply(state, { type: "rename", label: "t" }), "t:1");
