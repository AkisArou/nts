/*---
description: "Object patterns in loop heads preserve getter/default order and exclude named fields from ordered rest."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-accessors, ts-symbols, ts-spread, ts-arrow-functions, ts-destructuring]
---*/
// AssignRow objects reach a for-of head through an array; node reads value before numeric-key rest getters and excludes value from the rest copy.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AssignRow { value: AssignValue; "2": AssignValue; label: AssignValue; }
for (const input of inputs) {
  const log: unknown[] = [], expected: unknown[] = ["iterator"], rows: AssignRow[] = [];
  for (let i = 0; i < 3; i++) rows.push({ get value() { const value = i === 0 ? undefined : i === 1 ? input : marker; log.push("get", i, "value", value); return value; },
    get "2"() { log.push("get", i, "2", input); return input; }, get label() { log.push("get", i, "label", marker); return marker; } });
  const original = rows.values.bind(rows);
  rows[Symbol.iterator] = () => { log.push("iterator"); const cursor = original(), next = cursor.next;
    cursor.next = () => { const step = next.call(cursor); log.push("next", step.done, step.value); return step; };
    cursor.return = () => { log.push("return", true, undefined); return { done: true, value: undefined }; }; return cursor; };
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  let index = 0;
  for (const { value: current = fallback(), ...rest } of rows) {
    const value = index === 0 ? undefined : index === 1 ? input : marker, wanted = value === undefined ? replacement : value;
    same(current, wanted); same(typeof rest, "object"); same(Object.is(rest, rows[index]), false);
    assert.compareArray(Object.keys(rest), ["2", "label"]); same(rest["2"], input); same(rest.label, marker); same("value" in rest, false);
    log.push("body", current); expected.push("next", false, rows[index], "get", index, "value", value);
    if (value === undefined) expected.push("default", replacement);
    expected.push("get", index, "2", input, "get", index, "label", marker, "body", wanted); index++;
  }
  expected.push("next", true, undefined); same(index, rows.length); assert.compareArray(log, expected);
}
