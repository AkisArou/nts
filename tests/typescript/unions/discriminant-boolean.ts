/*---
description: A boolean literal property discriminates a union of result types.
features: [ts-unions, ts-narrowing, ts-discriminated-unions, ts-literal-types]
---*/
type Result = { ok: true; value: number } | { ok: false; error: string };
function parse(text: string): Result {
  const n = Number(text);
  return Number.isNaN(n) ? { ok: false, error: `bad ${text}` } : { ok: true, value: n };
}
function show(result: Result): string {
  return result.ok ? `value ${result.value}` : result.error;
}
assert.sameValue(show(parse("12")), "value 12");
assert.sameValue(show(parse("x")), "bad x");
