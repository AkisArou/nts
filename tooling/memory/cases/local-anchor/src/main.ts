// The same walk `traversal` does, over a list the function owns itself.
//
// `traversal` eliminates 40% and this eliminates nothing, and the only
// difference is where the head lives: there it arrives as a parameter, here it
// is a local. `survives_the_function` says outright why -- "a value the
// *function* allocated is not [alive for a reason nothing here can affect], it
// can die here, and the borrow with it" -- and in this program that is exactly
// what happens. The head is passed into the walk's block parameter and is never
// named again, so its reference dies on that edge, and a cursor borrowed from
// it would outlive what it borrowed from.
//
// The answer is not to count the walk. It is that the head is an *anchor*: the
// frame owns it, nothing releases it, and it must stay alive as long as
// anything borrowed from it is. An owned local can anchor a borrow, and until
// it can, every walk over a list a function built pays full price.

class Link {
  value: number;
  next: Link | null;
  constructor(v: number) { this.value = v; this.next = null; }
}

function build(length: number): Link {
  const head = new Link(0);
  let tail = head;
  for (let i = 1; i < length; i++) {
    const made = new Link(i);
    tail.next = made;
    tail = made;
  }
  return head;
}

export function work(n: number): number {
  const head = build(16 + n);
  let at: Link | null = head;
  let total = 0;
  while (at !== null) {
    total = total + at.value;
    at = at.next;
  }
  return total;
}
