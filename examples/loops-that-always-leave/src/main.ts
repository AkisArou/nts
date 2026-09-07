// A loop whose body never reaches the end of itself.
//
// Every loop here is built with a latch: the block that runs the update and
// jumps back to the header. It has to exist before the body is lowered, because
// `continue` needs its id. When the body turns out to leave on every path --
// one unconditional `break`, or a `return` -- nothing ever jumps to that block,
// and it sits in the function with an id the other terminators are numbered
// around.
//
// That is dead code and not a malformed graph, and the compiler said
// `invalid HIR` and refused the program. The construct is ordinary: take the
// first key of a map and stop, which is how an LRU eviction is written.
//
// These cases are answers rather than shapes, so what they really check is that
// the program compiles at all -- which is the whole of what was wrong.

export function firstKeyThenStop(n: number): number {
  const records = new Map<string, number>();
  records.set("a", n);
  records.set("b", n + 1);
  let evicted = 0;
  for (const oldest of records.keys()) {
    records.delete(oldest);
    evicted = evicted + 1;
    break;
  }
  return evicted * 100 + records.size;
}

// The same over an array, where the walk is an index rather than a cursor.
export function firstElementThenStop(n: number): number {
  const xs = [n, n + 1, n + 2];
  let seen = 0;
  for (const x of xs) {
    seen = seen + x;
    break;
  }
  return seen;
}

// A `while`, whose latch is its header -- so this one was never affected, and
// it is here to say which of the two shapes the bug was in.
export function whileThatAlwaysBreaks(n: number): number {
  let count = 0;
  while (count < 10) {
    count = count + n;
    break;
  }
  return count;
}

// A `for` with an update, which is the same shape as the `for...of`: the update
// is the latch, and a body that always leaves never runs it. If the update ran
// anyway the answer would be one higher.
export function forWithUnreachableUpdate(n: number): number {
  let i = 0;
  for (i = 0; i < 10; i = i + 1) {
    if (n >= 0) {
      break;
    }
    break;
  }
  return i;
}

// `return` rather than `break`, which leaves the function as well as the loop
// and so leaves the latch just as unreachable.
export function returnsOutOfTheFirstTurn(n: number): number {
  const xs = [n, n + 1];
  for (const x of xs) {
    return x * 2;
  }
  return -1;
}

// And the case that must NOT lose its latch: a `continue` reaches it even
// though the fall-through does not. A fix that removed the block whenever the
// body ended in a jump would break this one and nothing above it.
export function continueKeepsTheLatch(n: number): number {
  const xs = [n, n + 1, n + 2, n + 3];
  let total = 0;
  for (const x of xs) {
    if (x % 2 === 0) {
      continue;
    }
    if (x > 100) {
      break;
    }
    total = total + x;
  }
  return total;
}

// Nested, with the inner loop always leaving and the outer one ordinary.
export function anInnerLoopThatAlwaysLeaves(n: number): number {
  const rows = [n, n + 1, n + 2];
  let total = 0;
  for (const row of rows) {
    const cells = [row, row * 10];
    for (const cell of cells) {
      total = total + cell;
      break;
    }
  }
  return total;
}
