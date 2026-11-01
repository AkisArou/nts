/*---
description: Control for widening-filter-built-union; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// Filter the same explicit member sequence by its kind, retaining identical callback payload checks, decisions, result order and concrete member reads.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; str: string; nil: null; undef: undefined; ref: WidenPoint; }
function member(kind: string, n: number, text: string, point: WidenPoint): ExplicitUnion { return { kind, num: n, str: text, nil: null, undef: undefined, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "null") { log.push("null"); same(value.nil, null); }
  else if (value.kind === "undefined") { log.push("undefined"); same(value.undef, undefined); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const source: ExplicitUnion[] = [member("null", n, text, point), member("number", n, text, point), member("undefined", n, text, point), member("string", n, text, point), member("object", n, text, point), member("null", n, text, point)], log: string[] = [], decisions: string[] = [];
  const built: ExplicitUnion[] = source.filter(value => {
    observe(value, n, text, point, log);
    if (value.kind === "null") { decisions.push("drop"); return false; }
    decisions.push("keep"); return true;
  });
  same(built.length, 4);
  for (const value of built) observe(value, n, text, point, log);
  assert.compareArray(decisions, ["drop", "keep", "keep", "keep", "keep", "drop"]);
  assert.compareArray(log, ["null", "number", "undefined", "string", "object", "null", "number", "undefined", "string", "object"]);
}
