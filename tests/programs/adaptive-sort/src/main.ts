// Natural-run, insertion and powersort boundaries. A comparator only borrows
// snapshot elements; removing the original references, retaining a new tail,
// collecting, or throwing must not turn scratch indices into owned references.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

function items(seed: number, shape: number): Item[] {
  const n = (seed & 127) + 65;
  const s = (seed | 0) & 1023;
  const xs: Item[] = [];
  for (let i = 0; i < n; i++) {
    let key = (i * 29 + s) % 17;
    if (shape === 1) key = i;
    if (shape === 2) key = n - i;
    if (shape === 3) key = ((n - i) / 4) | 0;
    if (shape === 4) key = ((((i / 7) | 0) & 1) === 0 ? i : n - i) % 41;
    xs.push(new Item(key, i));
  }
  return xs;
}

function tags(xs: Item[]): string {
  return xs.map(x => String(x.key) + ":" + String(x.tag)).join(",");
}

export function ordered(seed: number): string {
  const xs = items(seed, 1);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

export function reversed(seed: number): string {
  const xs = items(seed, 2);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

// Equal descending keys must retain their earlier tag order: reversing an
// entire nonincreasing run would pass the distinct-key reversed control above.
export function reversedEqual(seed: number): string {
  const xs = items(seed, 3);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

export function unevenRuns(seed: number): string {
  const xs = items(seed, 4);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

// Pure control beside the one-change mutation and throwing arms below.
export function shuffled(seed: number): string {
  const xs = items(seed, 0);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

export function throwing(seed: number): string {
  const xs = items(seed, 0);
  let calls = 0;
  try {
    xs.sort((a, b) => {
      calls++;
      if (calls === 2) throw new RangeError("stop");
      return a.key - b.key;
    });
  } catch {
    return "caught:" + tags(xs);
  }
  return "quiet:" + tags(xs);
}

export function mutating(seed: number): string {
  const xs = items(seed, 0);
  let calls = 0;
  xs.sort((a, b) => {
    if (calls === 0) { xs.length = 0; xs.push(new Item(10000, 10000)); }
    calls++;
    return a.key - b.key;
  });
  return tags(xs);
}

export function mutatingThrow(seed: number): string {
  const xs = items(seed, 0);
  let calls = 0;
  try {
    xs.sort((a, b) => {
      if (calls === 0) { xs.length = 0; xs.push(new Item(10000, 10000)); }
      calls++;
      if (calls === 2) throw new RangeError("stop");
      return a.key - b.key;
    });
  } catch {
    return "caught:" + tags(xs);
  }
  return "quiet:" + tags(xs);
}

export function copied(seed: number): string {
  const xs = items(seed, 0);
  const ys = xs.toSorted((a, b) => a.key - b.key);
  return tags(xs) + "|" + tags(ys);
}

export function copiedMutating(seed: number): string {
  const xs = items(seed, 0);
  const ys = xs.toSorted((a, b) => {
    xs.length = 0;
    return a.key - b.key;
  });
  return tags(xs) + "|" + tags(ys);
}

export function copiedThrow(seed: number): string {
  const xs = items(seed, 0);
  let calls = 0;
  try {
    const ys = xs.toSorted((a, b) => {
      xs.length = 0;
      calls++;
      if (calls === 2) throw new RangeError("stop");
      return a.key - b.key;
    });
    return "quiet:" + tags(xs) + "|" + tags(ys);
  } catch {
    return "caught:" + tags(xs);
  }
}
