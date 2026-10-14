// A real cycle, which is the case that must *not* reach zero.
//
// Every other case here is trying to drive the count down. This one exists to
// stop it: `a` and `b` point at each other, neither reference ever reaches
// zero, and the collector is the only thing that can free them. It can only do
// that if the counts on the two internal edges are actually there.
//
// So an elision pass that gets clever here does not make this faster, it makes
// it leak -- and the leak check is what says so.

class Node {
  value: number;
  peer: Node | null;
  constructor(v: number) { this.value = v; this.peer = null; }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 8 + n; i++) {
    const a = new Node(i);
    const b = new Node(i + 1);
    a.peer = b;
    b.peer = a;
    total = total + (a.peer === null ? 0 : a.peer.value);
  }
  return total;
}
