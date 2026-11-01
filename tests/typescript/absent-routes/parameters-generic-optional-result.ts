/*---
description: An optional generic parameter returns undefined after present calls across five type arguments.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-generics, ts-optional-parameters, ts-tuples, ts-expressions]
---*/
// One generic optional return is exercised at number, string, object, null and boolean; omission after a present call returns undefined, never the prior value.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type OptionalSnapshot<T> = { value: T | undefined; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function inspect<T>(value?: T): OptionalSnapshot<T> {
  return { value, count: arguments.length, present: 0 in arguments, own: Object.hasOwn(arguments, 0),
    keys: Object.keys(arguments), json: JSON.stringify(arguments) };
}
function exercise<T>(value: T, json: string): void {
  for (const mode of [1, 0, 2]) {
    const result = mode === 0 ? inspect<T>() : mode === 1 ? inspect<T>(value) : inspect<T>(undefined);
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
