// Two structures sharing one tail.
//
// The case where counting is genuinely load-bearing: the shared nodes are
// reachable two ways, so giving one head back must not free them, and giving
// both back must. A pass that elides its way to zero here is wrong, and the
// leak check and the answer are what say so.

class Link {
  value: number;
  next: Link | null;
  constructor(v: number) {
    this.value = v;
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
  const shared = chain(16 + n);
  const left = new Link(100);
  const right = new Link(200);
  left.next = shared;
  right.next = shared;
  return total(left) + total(right);
}
