// A walk whose steps go through a call. `borrows_safely` used to give up the
// moment one appeared, which is every traversal in real code -- `Element#length`
// is `return 1 + this.next.length()`.

class Link {
  value: number;
  next: Link | null;
  constructor(value: number) { this.value = value; this.next = null; }
}

function chain(length: number): Link {
  const head = new Link(0);
  let tail = head;
  for (let i = 1; i < length; i++) { const made = new Link(i); tail.next = made; tail = made; }
  return head;
}

// Stores nothing, so nothing it does can invalidate the caller's borrow.
function weigh(link: Link): number { return link.value + 1; }

function total(head: Link | null): number {
  let sum = 0;
  let at = head;
  while (at !== null) { sum = sum + weigh(at); at = at.next; }
  return sum;
}

export function work(n: number): number { return total(chain(32 + n)); }
