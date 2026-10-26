// 2048 small parent/child cycles per unit. No explicit collection or manual
// unlinking: the row includes the runtime's production reclamation policy.
class Link {
  value: number;
  parent: Link | null = null;
  child: Link | null = null;
  constructor(value: number) { this.value = value; }
}

export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let i = 0; i < 2048 * n; i++) {
    const parent = new Link(i | 0);
    const child = new Link((i + 1) | 0);
    parent.child = child;
    child.parent = parent;
    total = (total + parent.child.value + child.parent.value) | 0;
  }
  return total;
}

export const seed = 0;
