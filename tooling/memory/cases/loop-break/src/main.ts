// A borrow that is live across a `break`, which is a block parameter with two
// predecessors and no back edge on one of them.
//
// The walk is the same one `traversal` does; what is different is that it
// leaves early, so the value carried around the loop reaches the exit block by
// two different routes. An analysis that gives up at a join gives up here.

class Link {
  value: number;
  next: Link | null;
  constructor(v: number) { this.value = v; this.next = null; }
}

export function work(n: number): number {
  const head = new Link(0);
  let tail = head;
  for (let i = 1; i < 16 + n; i++) {
    const made = new Link(i);
    tail.next = made;
    tail = made;
  }
  let at: Link | null = head;
  let total = 0;
  while (at !== null) {
    if (at.value > 8) {
      break;
    }
    total = total + at.value;
    at = at.next;
  }
  return total;
}
