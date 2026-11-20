// Natural-run, insertion and powersort boundaries. A comparator only borrows
// snapshot elements; removing the original references, retaining a new tail,
// collecting, or throwing must not turn scratch indices into owned references.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

function items(seed: number, shape: number): Item[] {
  const n = (seed & 1023) + 65;
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

// Two sites with one typed comparator share a generated helper family.
export function sharedHelpers(seed: number): string {
  const xs = items(seed, 0);
  const ys = items(seed, 4);
  const compare = (a: Item, b: Item): number => a.key - b.key;
  xs.sort(compare);
  ys.sort(compare);
  return tags(xs) + "|" + tags(ys);
}

// The fifth comparison is inside minimum-run insertion, after run detection.
export function throwingInsertion(seed: number): string {
  const xs = items(seed, 0);
  let calls = 0;
  try {
    xs.sort((a, b) => {
      if (++calls === 5) throw new RangeError("insertion");
      return a.key - b.key;
    });
  } catch {
    return "caught:" + tags(xs);
  }
  return "quiet:" + tags(xs);
}

function separatedRuns(seed: number, throwAt: number): string {
  const n = (seed & 15) + 64;
  const cut = (n / 2) | 0;
  const xs: Item[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(new Item((i < cut ? i + n - cut : i - cut) + (seed & 7), i));
  }
  let crosses = 0;
  try {
    xs.sort((a, b) => {
      // Adjacent boundary comparisons belong to natural-run detection and
      // the merge's ordered-boundary control, not the merge/search body.
      if ((a.tag < cut) !== (b.tag < cut) && Math.abs(a.tag - b.tag) > 1) {
        if (++crosses === throwAt) throw new RangeError("merge");
      }
      return a.key - b.key;
    });
  } catch {
    return "caught:" + tags(xs);
  }
  return "quiet:" + tags(xs);
}

export function separatedRunsControl(seed: number): string { return separatedRuns(seed, 0); }
export function throwingMerge(seed: number): string { return separatedRuns(seed, 1); }
// Seven ordinary right wins enter the first galloping probe; it throws.
export function throwingGallop(seed: number): string { return separatedRuns(seed, 8); }

export function nanComparator(seed: number): string {
  const xs = items(seed, 0);
  xs.sort(() => NaN);
  return tags(xs);
}
