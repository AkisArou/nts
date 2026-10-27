// 2048 small parent/child cycles per unit, retained in a bounded 64-slot ring.
// Replacing an old pair makes a garbage cycle; the ring prevents immediate
// frame placement. No explicit collection or manual unlinking: this includes
// the runtime's production reclamation policy.
class Link {
  value: number;
  parent: Link | null = null;
  child: Link | null = null;
  constructor(value: number) { this.value = value; }
}

export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  const ring: Link[] = [];
  for (let i = 0; i < 2048 * n; i++) {
    const slot = i & 63;
    if (i >= 64) {
      const old = ring[slot];
      total = (total + old.child!.value + old.child!.parent!.value) | 0;
    }
    const parent = new Link(i | 0);
    const child = new Link((i + 1) | 0);
    parent.child = child;
    child.parent = parent;
    if (i < 64) ring.push(parent);
    else ring[slot] = parent;
  }
  for (let slot = 0; slot < ring.length; slot++) {
    const parent = ring[slot];
    total = (total + parent.child!.value + parent.child!.parent!.value) | 0;
  }
  return total;
}

export const seed = 0;
