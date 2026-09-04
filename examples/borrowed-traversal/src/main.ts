// The shapes reference counting gets wrong, and a check that can fail.
//
// `hir::rc` skips counting entirely inside a function that contains no store,
// no call and no allocation: nothing in such a body can invalidate a borrow, so
// every load in it reads the slot rather than taking a reference of its own.
// That rule took `awfy-list` from 12.97x hand-written C++ to 2.23x, and the
// benchmark cannot check it -- a leak and a double-free both return the right
// answer, and only `tooling/gate/rc.sh` looks at what is still live afterwards.
//
// So the traversals below are deliberately *inert* in that sense, and each one
// is a way for the rule to be wrong: a borrow carried across a back edge, a
// borrow returned to a caller that owns it, two chains sharing one tail, a walk
// abandoned half way, and a cycle that only the collector can free.
//
// Not covered, and it is the honest gap: a borrow crossing a `throw`.
// `try`/`catch` does not lower yet, so there is nothing to write.

class Link {
  value: number;
  next: Link | null;

  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

// Allocates, so not inert -- this is the ordinary path, kept beside the others
// so a mistake in either shows up as a difference between them.
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

// Inert: two loads, a null test and a back edge, and nothing else. This is
// `List#isShorterThan`, which spent sixteen reference-counting operations on
// five lines of work.
function total(head: Link | null): number {
  let sum = 0;
  let at = head;
  while (at !== null) {
    sum = sum + at.value;
    at = at.next;
  }
  return sum;
}

// Inert, and it hands a borrow *back*. The caller is owed a reference it owns,
// so this is the one place an inert function still has to retain.
function lastOf(head: Link | null): Link | null {
  let at = head;
  while (at !== null && at.next !== null) {
    at = at.next;
  }
  return at;
}

// Inert, and abandoned part way: the borrow held at the return is live and the
// rest of the chain is not.
function firstAbove(head: Link | null, bound: number): number {
  let at = head;
  while (at !== null) {
    if (at.value > bound) {
      return at.value;
    }
    at = at.next;
  }
  return -1;
}

export function walkedOnce(length: number): number {
  return total(chain(length + 8));
}

// The borrow returned by `lastOf` outlives the call and is read afterwards.
export function borrowSurvivesTheCall(length: number): number {
  const end = lastOf(chain(length + 8));
  return end === null ? -1 : end.value;
}

// Two chains sharing one tail. Walking both reads every shared node twice, and
// releasing the two heads must not free the tail twice.
export function sharedTailCountedOnce(length: number): number {
  const shared = chain(length + 4);
  const left = new Link(100);
  const right = new Link(200);
  left.next = shared;
  right.next = shared;
  return total(left) + total(right);
}

export function abandonedHalfWay(length: number): number {
  return firstAbove(chain(length + 8), 3);
}

// A cycle: reference counting alone can never free this, and the collector is
// what has to. The leak check in `tooling/gate/rc.sh` is what reads the answer.
export function cycleIsCollected(length: number): number {
  const head = chain(length + 4);
  const end = lastOf(head);
  if (end !== null) {
    end.next = head;
  }
  // Bounded walk, because the chain no longer ends.
  let at: Link | null = head;
  let seen = 0;
  for (let i = 0; i < 12; i++) {
    if (at === null) {
      break;
    }
    seen = seen + at.value;
    at = at.next;
  }
  return seen;
}
