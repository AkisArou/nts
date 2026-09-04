// A borrow that is live across a `break`: a block parameter reached by two
// edges, one of which is not the back edge.
//
// Written to isolate the join, and it does not -- which is worth leaving here
// as the record of a wrong guess. This eliminates nothing, and so does the same
// walk with the `break` taken out; a walk over a *parameter* with a `break` put
// in still eliminates 28%. The join is fine. What stops both is that the head
// is a local, which `local-anchor` isolates without the confounder.

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
