/*---
description: Implicit string conversion keeps a bounded string allocated by its caller.
features: [ts-lifetime-frame, ts-route-hook, ts-functions, ts-iteration, ts-closures, ts-objects, ts-arrays, ts-strings, ts-to-string, ts-template-literals]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: toString captures the bounded slice and stores it; node keeps its exact text after the call.
function prepare(n: number, out: string[]): string {
  const start = n % 20;
  const text = "abcdefghijklmnopqrstuvwxyz".slice(start, start + 3);
  const hook = { toString(): string { out.push(text); return "seen"; } };
  return `${hook}`;
}
for (let n = 0; n < 240; n++) {
  const kept: string[] = [];
  assert.sameValue(prepare(n, kept), "seen");
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, []), "seen");
  const start = n % 20;
  assert.sameValue(kept.length, 1);
  assert.sameValue(kept[0], String.fromCharCode(97 + start, 98 + start, 99 + start));
  assert.sameValue(kept[0].length, 3);
}
