/*---
description: "Array.of builds one-element arrays without coercing the selected number or string branch. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localOf<T>(...values: T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < values.length; index++) result[index] = values[index];
  return result;
}
// Array.of builds one-element arrays without coercing the selected number or string branch. Route: a discriminated union selecting the argument kind. Node prints construction-of-discriminated-values:ok.
type OfChoice = { kind: "number"; amount: number } | { kind: "text"; label: string };
function create(choice: OfChoice): (number | string)[] {
  if (choice.kind === "number") return localOf(choice.amount);
  return localOf(choice.label);
}
const rows: readonly [OfChoice, number | string][] = [
  [{ kind: "number", amount: 7 }, 7], [{ kind: "number", amount: -0 }, -0],
  [{ kind: "text", label: "7" }, "7"], [{ kind: "text", label: "" }, ""]
];
for (const [choice, expected] of rows) {
  const result = create(choice), repeated = create(choice);
  assert.compareArray(result, [expected]); assert.sameValue(result === repeated, false);
  assert.sameValue(Object.is(result[0], expected), true);
}
console.log("construction-of-discriminated-values:ok");
