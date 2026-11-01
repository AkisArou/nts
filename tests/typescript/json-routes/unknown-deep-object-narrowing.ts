/*---
description: Repeated unknown and in narrowing reads all eight nested records before observing a signed zero, fraction or rounded wide integer leaf.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-numbers, ts-strings, ts-tuples, ts-null-undefined]
---*/
// Parse eight nested objects to unknown and narrow one level per iteration; node preserves every depth field and the numeric leaf.
function check(token: string, expected: number): void {
  let text = '{"value":' + token + '}';
  for (let depth = 7; depth >= 0; depth--) text = '{"depth":' + depth + ',"next":' + text + '}';
  const value: unknown = JSON.parse(text);
  let current: unknown = value;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof current !== "object" || current === null || !("depth" in current) || !("next" in current)) throw new Error("level");
    assert.sameValue(typeof current, "object"); assert.compareArray(Object.keys(current), ["depth", "next"]);
    assert.sameValue(typeof current.depth, "number"); assert.sameValue(Object.is(current.depth, depth), true);
    assert.sameValue(typeof current.next, "object");
    current = current.next;
  }
  if (typeof current !== "object" || current === null || !("value" in current)) throw new Error("leaf");
  assert.sameValue(typeof current, "object"); assert.compareArray(Object.keys(current), ["value"]);
  assert.sameValue(typeof current.value, "number"); assert.sameValue(Object.is(current.value, expected), true);
}
const rows: [string, number][] = [["-0", -0], ["1.25", 1.25], ["9007199254740993", 9007199254740992]];
for (const [token, expected] of rows) check(token, expected);
