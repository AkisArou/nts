/*---
description: A narrower union crosses a wider parameter and retains its payload after field storage.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples]
---*/
// Number, string and object inputs widen into a field that also holds boolean, null and undefined; Node preserves each stored member and the exact narrowing order.
type WidenPoint = { id: number };
type Wider = number | string | boolean | null | undefined | WidenPoint;
type Incoming = number | string | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Wider, n: number, text: string, flag: boolean, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (typeof value === "boolean") { log.push("boolean"); same(value, flag); }
  else if (value === null) { log.push("null"); same(value, null); }
  else if (value === undefined) { log.push("undefined"); same(value, undefined); }
  else if (typeof value === "object" && value !== null) { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
function retain(value: Wider): { value: Wider } { return { value }; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const flag = text.length > 0, incoming: Incoming[] = [n, text, point], log: string[] = [];
  const stored: { value: Wider }[] = [];
  for (const value of incoming) stored.push(retain(value));
  stored.push(retain(flag), retain(null), retain(undefined));
  same(stored.length, 6);
  for (const entry of stored) observe(entry.value, n, text, flag, point, log);
  assert.compareArray(log, ["number", "string", "object", "boolean", "null", "undefined"]);
}
