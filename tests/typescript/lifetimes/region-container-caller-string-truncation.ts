/*---
description: A truncated array in a region candidate cannot release the caller's retained input string.
features: [ts-lifetime-region, ts-route-container, ts-functions, ts-objects, ts-arrays, ts-strings]
---*/
// Fact: call-result regions must honor helper ownership (docs/foundations/memory.md, Where nts stands).
// Route: a caller's array retains its input while the builder pushes then truncates it.
// Node keeps the exact caller string after the result and temporary array die.
function build(input: string, n: number): { child: { value: number }; size: number } {
  const temporary: string[] = [];
  temporary.push(input);
  const size = temporary[0].length;
  temporary.length = 0;
  return { child: { value: n * 7 }, size };
}
function exercise(input: string, n: number): void {
  const root = build(input, n);
  assert.sameValue(root.child.value, n * 7);
  assert.sameValue(root.size, input.length);
}
for (let n = 0; n < 240; n++) {
  const saved = ["caller:" + n];
  exercise(saved[0], n);
  for (let i = 0; i < 12; i++) exercise("caller:" + (n + 512 + i), i);
  assert.sameValue(saved[0], "caller:" + n);
  assert.sameValue(saved[0].length, 7 + String(n).length);
  saved.length = 0;
}
