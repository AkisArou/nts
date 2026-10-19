/*---
description: A typed tag function receives the template's strings, raw strings and substitutions, and the strings array is the same object on each evaluation of one site.
features: [ts-tagged-templates]
---*/
const seen: TemplateStringsArray[] = [];
function tag(strings: TemplateStringsArray, ...values: number[]): string {
  seen.push(strings);
  return strings.raw.map((s, i) => s + (i < values.length ? values[i] * 2 : "")).join("");
}
function render(n: number): string {
  return tag`a${n}\n${n + 1}`;
}
assert.sameValue(render(1), "a2\\n4");
render(5);
assert.sameValue(seen[0] === seen[1], true);
assert.sameValue(seen[0][1], "\n");
assert.sameValue(Object.isFrozen(seen[0]), true);
