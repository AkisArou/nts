/*---
description: A destructuring default invokes the getter that moves a string index past the end.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties, ts-strings, ts-numbers]
---*/
// Fact: index 0 starts below the string length 4 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? NaN : 97; the operation result is checked separately.
function observe(change: number) {
  const text = "abcd";
  let index = 0;
  class Gate {
    get token(): number { index = 4; return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: text.charCodeAt(index), token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? NaN : 97);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
