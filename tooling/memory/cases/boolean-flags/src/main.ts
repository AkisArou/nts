// A boolean, in every place a value can acquire a cost.
//
// The other zero cases here are about an *object* that never escapes. This one
// is about a value that was never on the heap to begin with, and it exists
// because "boolean costs nothing" was an assertion in a record with no
// instrument behind it. Zero is the answer; what was missing is a case that
// would say so if it stopped being true.
//
// So the boolean is put where a value gets charged: a field of an object, a
// parameter, a return, and the payload of an erased slot. Each of those is a
// mechanism that would fire on a reference, and none of them may fire here.

class Gate {
  open: boolean;
  seen: boolean;
  constructor(open: boolean) {
    this.open = open;
    this.seen = false;
  }
}

function both(a: boolean, b: boolean): boolean {
  return a && b;
}

// `boolean | undefined`, which is erased: a bool has no spare bit pattern to
// spend on an absence any more than a double does.
function maybeOpen(n: number): boolean | undefined {
  return n < 0 ? undefined : n > 0;
}

export function work(n: number): number {
  const gate = new Gate(n > 0);
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    gate.open = !gate.open;
    const held = maybeOpen(i - 1);
    const mark = held ?? false;
    gate.seen = both(gate.open, mark);
    if (gate.seen) {
      total = total + 1;
    }
  }
  return total + (gate.seen ? 1 : 0);
}
