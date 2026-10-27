// The sort owns an immutable snapshot while uint32 index buffers are merged.
// Its comparator may reenter, remove the source's last references, or throw.
class Item {
  key: number;
  tag: number;
  constructor(key: number, tag: number) { this.key = key; this.tag = tag; }
}

function items(n: number): Item[] {
  const xs: Item[] = [];
  for (let i = 0; i < (n & 15); i++) xs.push(new Item((i * 7) % 5, i));
  return xs;
}

function tags(xs: Item[]): string {
  return xs.map(x => String(x.key) + ":" + String(x.tag)).join(",");
}

export function stableObjects(n: number): string {
  const xs = items(n);
  xs.sort((a, b) => a.key - b.key);
  return tags(xs);
}

// The one-difference control: the comparator does not remove the original
// references. Both results must have the same elements and stable order.
export function emptiedSource(n: number): string {
  const xs = items(n);
  xs.sort((a, b) => {
    xs.length = 0;
    return a.key - b.key;
  });
  return tags(xs);
}

export function reentrant(n: number): string {
  const xs = items(n);
  let entered = false;
  xs.sort((a, b) => {
    if (!entered) {
      entered = true;
      xs.sort((x, y) => y.key - x.key);
      xs.length = 0;
    }
    return a.key - b.key;
  });
  return tags(xs);
}

export function retainArgument(n: number): number {
  const xs = items(n);
  const saved: Item[] = [];
  xs.sort((a, b) => {
    if (saved.length === 0) saved.push(a);
    xs.length = 0;
    return a.key - b.key;
  });
  // Comparator call order is unspecified: test the saved object's identity
  // and liveness, not which element the engine happened to compare first.
  return saved.length === 0 ? xs.length : (xs.includes(saved[0]!) ? 100 : -100) + xs.length;
}

export function throwing(n: number): string {
  const xs = items(n);
  try {
    xs.sort((a, b) => {
      if (a.key >= 0 && b.key >= 0) throw new RangeError("stop");
      return a.key - b.key;
    });
  } catch {
    // A partially filled index buffer has no managed edges to release. The
    // original array still has its initial order and owns all its elements.
    return "caught:" + tags(xs);
  }
  return "quiet:" + tags(xs);
}

export function copied(n: number): string {
  const xs = items(n);
  const ys = xs.toSorted((a, b) => a.key - b.key);
  return tags(xs) + "|" + tags(ys);
}

export function stableStrings(n: number): string {
  const xs = ["ccc", "a", "bb", String(n & 15), "dd", "e"];
  xs.sort((a, b) => a.length - b.length);
  return xs.join(",");
}

export function numericControl(n: number): string {
  const xs = [n & 15, 3, 1, 2, 1];
  xs.sort((a, b) => a - b);
  return xs.join(",");
}
