// `T | null` and `T | undefined` cost nothing.
//
// A reference already has a value that is not an object, so the absence needs
// no tag beside it: the null pointer *is* the tag, and `Element | null` is the
// same machine type as `Element`. That is what makes a linked list, a tree, and
// every `find` that might not find anything ordinary code here rather than a
// refusal.
//
// What it relies on is TypeScript's strict null checking. `at.value` where `at`
// is `Element | null` is a type error, so the compiler never emits a load
// through a pointer the checker has not proved present. Without `strict` this
// would be a segmentation fault where JavaScript raises a TypeError.

class Element {
  value: number;
  next: Element | null;

  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

// Build a list, then walk it. `head` starts absent and the walk ends when the
// chain does.
export function sumChain(n: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = n > 65536 ? 65536 : n;
  let head: Element | null = null;
  for (let i = 0; i < bound; i++) {
    const made = new Element(i);
    made.next = head;
    head = made;
  }
  let total = 0;
  let at: Element | null = head;
  while (at !== null) {
    total = total + at.value;
    at = at.next;
  }
  return total;
}

// The length of a chain, counted with truthiness rather than a comparison.
export function lengthOf(n: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = n > 65536 ? 65536 : n;
  let head: Element | null = null;
  for (let i = 0; i < bound; i++) {
    const made = new Element(i);
    made.next = head;
    head = made;
  }
  let count = 0;
  let at: Element | null = head;
  while (at) {
    count = count + 1;
    at = at.next;
  }
  return count;
}

// A search that may not find anything. This is the shape `Array.find` has, and
// the reason `T | undefined` matters as much as `T | null`.
function findValue(head: Element | null, wanted: number): Element | undefined {
  let at: Element | null = head;
  while (at !== null) {
    if (at.value === wanted) {
      return at;
    }
    at = at.next;
  }
  return undefined;
}

export function foundAt(n: number, wanted: number): number {
  // Bounded because the differential sweeps this parameter through a pool that
  // contains 2^31, 2^32 and 2^53. Those are useful as *values* and useless as a
  // loop bound: neither node nor the compiled program finishes, both are killed
  // at twenty seconds, and the case is abandoned along with the rest of this
  // function's batch -- scored as neither agreement nor disagreement, so it
  // bought nothing but wall clock, five times over because five backend lanes
  // run the same examples. Clamped, the same case is checked instead.
  const bound = n > 65536 ? 65536 : n;
  let head: Element | null = null;
  for (let i = 0; i < bound; i++) {
    const made = new Element(i);
    made.next = head;
    head = made;
  }
  const hit = findValue(head, wanted);
  if (hit === undefined) {
    return -1;
  }
  return hit.value;
}

// A nullable string, which is where an empty one being falsy matters.
export function labelWidth(pick: number): number {
  let label: string | null = null;
  if (pick > 0) {
    label = "closure";
  } else if (pick === 0) {
    label = "";
  }
  if (label) {
    return label.length;
  }
  return -1;
}

// A nullable reference passed and returned, so the absence crosses a call.
function longer(a: Element | null, b: Element | null): Element | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  if (a.value >= b.value) {
    return a;
  }
  return b;
}

export function pickLonger(x: number, y: number): number {
  const a = x < 0 ? null : new Element(x);
  const b = y < 0 ? null : new Element(y);
  const best = longer(a, b);
  if (best === null) {
    return -1;
  }
  return best.value;
}
