// Walking a linked structure and reading from it. No store, no call.
//
// The shape `List#isShorterThan` has, which spent sixteen reference-counting
// operations on five lines of work before any of this existed.

class Link {
  value: number;
  next: Link | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function chain(length: number): Link {
  const head = new Link(0);
  let tail = head;
  for (let i = 1; i < length; i++) {
    const made = new Link(i);
    tail.next = made;
    tail = made;
  }
  return head;
}

// Inert: two loads, a comparison and a back edge.
function total(head: Link | null): number {
  let sum = 0;
  let at = head;
  while (at !== null) {
    sum = sum + at.value;
    at = at.next;
  }
  return sum;
}

export function work(n: number): number {
  return total(chain(32 + n));
}
