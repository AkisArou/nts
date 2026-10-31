/*---
description: A caught alias closes an unknown self-edge after its object survives unwinding.
features: [ts-lifetime-acyclic, ts-route-throw, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-errors, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: throwing exposes the initially empty edge to a caught alias; Node preserves the cycle it then closes.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
class Cell {
  id: number; text: string; edge: unknown = null;
  constructor(n: number) { this.id = n; this.text = "cell:" + n; }
}
function check(value: Cell, n: number): void {
  assert.sameValue(value.id, n); assert.sameValue(value.text, "cell:" + n);
  assert.sameValue(value.text.length, ("cell:" + n).length);
}
function churn(n: number): void {
  const all: Cell[] = [];
  for (let i = 0; i < 24; i++) all.push(new Cell(n + i + 1000));
  for (let i = 0; i < all.length; i++) { check(all[i], n + i + 1000); assert.sameValue(all[i].edge, null); }
}

function raise(n: number): never {
  const value = new Cell(n);
  throw value;
}
for (let n = 0; n < 240; n++) {
  let caught = false;
  try { raise(n); }
  catch (error: unknown) {
    if (!(error instanceof Cell)) throw error;
    caught = true;
    assert.sameValue(error.edge, null);
    error.edge = error;
    churn(n);
    check(error, n);
    assert.sameValue(error.edge === error, true);
  }
  assert.sameValue(caught, true);
}
