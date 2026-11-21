// Reads that finish before the store or call that would end them.
//
// A borrow is good for as long as the slot it was read from still holds it,
// and it is only *observed* where it is read. Each function here reads a
// chain out of a slot -- across the null checks a `!` makes, an early return
// or a loop -- and only then overwrites that slot, so no read needs a
// reference of its own. The controls are the `before` functions of
// `tests/programs/a-borrow-read-around-the-store-that-ends-it`: the same
// shapes with each store moved in front of the last read, where every read
// after it needs a reference of its own. They are run against node under
// reference counting there, and their counts are asserted beside these in
// `compiler/core/tests/counting_moves.rs`.
//
// `back` makes each pair a cycle, so the borrows rest on a graph that is not
// a tree: the ring is what keeps it alive while it is read.

class Node {
  value: number;
  next: Node | null = null;
  back: Node | null = null;
  constructor(value: number) { this.value = value; }
}

function pair(value: number): Node {
  const head = new Node(value);
  const tail = new Node(value + 1);
  head.next = tail;
  tail.back = head;
  return head;
}

// `cyclic-churn`'s shape: a chain read across two null checks (and the throw
// each one guards), and then the slot it came from overwritten.
function replaceAfterBranches(ring: Node[], slot: number, fresh: Node): number {
  const old = ring[slot];
  const sum = old.next!.value + old.next!.back!.value;
  ring[slot] = fresh;
  return sum;
}

// An early return on one arm, and a field store after the last read on the
// other.
function relinkAfterEarlyExit(ring: Node[], slot: number, fresh: Node): number {
  const old = ring[slot];
  const next = old.next;
  if (next === null) return 0;
  const value = next.value;
  old.next = fresh;
  return value;
}

// In a loop: each iteration's borrow is dead before its slot is overwritten,
// and before the next iteration reads again.
function replaceInLoop(ring: Node[], fresh: Node): number {
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const old = ring[i];
    total = total + old.next!.value;
    ring[i] = fresh;
  }
  return total;
}

// Carried round a loop by its parameter, and read before the store.
function carriedPastNoStore(ring: Node[], fresh: Node): number {
  let total = 0;
  let at = ring[0];
  for (let i = 1; i < ring.length; i++) {
    total = total + at.value;
    ring[i - 1] = fresh;
    at = ring[i];
  }
  return total + at.value;
}

export function work(n: number): number {
  const ring: Node[] = [];
  for (let i = 0; i < 4 + n; i++) ring.push(pair(i * 10));
  const fresh = pair(1000);
  let total = 0;
  total = total + replaceAfterBranches(ring, 0, fresh);
  total = total + relinkAfterEarlyExit(ring, 1, fresh);
  total = total + replaceInLoop(ring, pair(2000));
  for (let i = 0; i < ring.length; i++) ring[i] = pair(i * 100);
  total = total + carriedPastNoStore(ring, fresh);
  return total;
}
