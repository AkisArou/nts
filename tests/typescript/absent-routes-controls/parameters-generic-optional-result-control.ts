/*---
description: Control for parameters-generic-optional-result; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-generics, ts-tuples]
---*/
// The generic return carries an explicit presence record; recorded argument keys and direct undefined selection replace optional-argument reads.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type OptionalSnapshot<T> = { value: T | undefined; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function inspect<T>(input: { present: boolean; value: T | undefined }): OptionalSnapshot<T> {
  return { value: input.present ? input.value : undefined, count: input.present ? 1 : 0, present: input.present, own: input.present,
    keys: input.present ? ["0"] : [], json: !input.present || input.value === undefined ? "{}" : '{"0":' + JSON.stringify(input.value) + '}' };
}
function exercise<T>(value: T, json: string): void {
  for (const mode of [1, 0, 2]) {
    const result = inspect<T>({ present: mode !== 0, value: mode === 1 ? value : undefined });
    same(result.value, mode === 1 ? value : undefined); same(result.count, mode === 0 ? 0 : 1);
    same(result.present, mode !== 0); same(result.own, mode !== 0);
    assert.compareArray(result.keys, mode === 0 ? [] : ["0"]); same(result.json, mode === 1 ? json : "{}");
  }
}
const rows: [number, string, string][] = [[-0, "", "0"], [NaN, "tail", "null"], [0, "next", "0"]];
for (const [n, text, encoded] of rows) {
  exercise<number>(n, '{"0":' + encoded + '}'); exercise<string>(text, '{"0":' + JSON.stringify(text) + '}');
  const point = { id: 7 }; exercise<{ id: number }>(point, '{"0":{"id":7}}');
  exercise<null>(null, '{"0":null}'); exercise<boolean>(false, '{"0":false}');
}
