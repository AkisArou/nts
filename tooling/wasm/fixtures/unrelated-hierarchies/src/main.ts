// Two unrelated dispatch hierarchies of one shape: a Q is structurally a P,
// and each program calls a different slot, so each vtable holds one entry of
// one signature and P1 and Q1 are one Wasm type to the engine. Moving a Q
// into a P must still be refused: P.b's vtable entry is Q's `a`. From the
// review of slice 1b (mainctl/tmp/review-slices/probes/vtable-order).
abstract class P { abstract a(): number; abstract b(): number; }
class P1 extends P { v = 1; a(): number { return 1; } b(): number { return 2; } }
class P2 extends P { v = 2; a(): number { return 3; } b(): number { return 4; } }
abstract class Q { abstract a(): number; abstract b(): number; }
class Q1 extends Q { v = 1; a(): number { return 10; } b(): number { return 20; } }
class Q2 extends Q { v = 2; a(): number { return 30; } b(): number { return 40; } }
function callB(p: P): number { return p.b(); }
function callA(q: Q): number { return q.a(); }
function asP(q: Q): P { return q; }
function makeQ(n: number): Q { return n > 0 ? new Q1() : new Q2(); }
function makeP(n: number): P { return n > 0 ? new P1() : new P2(); }
export function probe(n: number): number {
  const q = makeQ(n);
  return callB(asP(q)) * 100 + callA(q) + callB(makeP(n)) * 1000;
}
