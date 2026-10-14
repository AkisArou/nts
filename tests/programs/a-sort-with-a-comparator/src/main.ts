// `xs.sort(compare)` and `xs.toSorted(compare)`, which were refused: "a `sort`
// with a comparator, which would have to call back into it". They are a
// stable merge sort the lowering writes as loops, calling the comparator as
// the function value it is (`lower_sort_with`), and each arm below is one of
// the things a merge sort gets wrong quietly.

interface Task {
  priority: number;
  name: string;
}

function tasks(n: number): Task[] {
  const made: Task[] = [];
  for (let i = 0; i < 6; i++) {
    made.push({ priority: (i * 7 + n) % 3, name: String.fromCharCode(97 + i) });
  }
  return made;
}

// **Stable**, which ES2019 requires and which is observable: equal keys keep
// the order they came in.
export function stable(n: number): string {
  const xs = tasks(n);
  xs.sort((a, b) => a.priority - b.priority);
  return xs.map((t) => String(t.priority) + t.name).join(",");
}

// A comparator answering NaN is answering 0 -- the order is kept -- and is not
// "less than".
export function nanIsZero(n: number): string {
  const xs = [n, 3, 1, 2];
  xs.sort(() => NaN);
  return xs.join(",");
}

// A comparator that changes the array while the sort runs: the order is then
// the specification's to leave unspecified, but the sort works on a snapshot
// of its own and writes back, so nothing is read out of bounds and every
// element is still there.
export function mutatedWhileSorting(n: number): number {
  const xs: Task[] = tasks(n);
  xs.sort((a, b) => {
    if (xs.length > 2) xs.pop();
    return a.priority - b.priority;
  });
  let sum = 0;
  for (const t of xs) sum += t.priority;
  return xs.length * 100 + sum;
}

export function emptied(n: number): number {
  const xs = [n, 5, 1, 4];
  xs.sort((a, b) => {
    xs.length = 0;
    return a - b;
  });
  return xs.length * 1000 + xs[0] * 100 + xs[3];
}

// And one that *adds* to the array: the sort sorts the elements it read
// before comparing anything and writes them back to the front, and what the
// comparator pushed stays after them, in the order it was pushed.
export function grownWhileSorting(n: number): string {
  const xs = [n, 3, 1, 2];
  let pushed = 0;
  xs.sort((a, b) => {
    if (pushed < 2) {
      pushed++;
      xs.push(100 + pushed);
    }
    return a - b;
  });
  return xs.join(",");
}

// Numbers descending, strings, a named function, a capturing arrow.
export function descending(n: number): string {
  const xs = [n, 8, 1, 9, 3];
  return xs.sort((a, b) => b - a).join(",");
}

export function byName(n: number): string {
  const xs = ["pear", "apple", "fig", String(n)];
  xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return xs.join(",");
}

function byLength(a: string, b: string): number {
  return a.length - b.length;
}

export function named(n: number): string {
  const xs = ["ccc", "a", "bb", "x".repeat(Math.max(0, Math.min(n, 4)))];
  xs.sort(byLength);
  return xs.join(",");
}

export function capturing(n: number): number {
  let calls = 0;
  const direction = n > 0 ? 1 : -1;
  const xs = [3, 1, 2, 5, 4];
  xs.sort((a, b) => {
    calls++;
    return direction * (a - b);
  });
  return xs[0] * 100 + (calls > 0 ? 1 : 0);
}

// `toSorted` answers a sorted copy and leaves the array alone.
export function copied(n: number): string {
  const xs = [n, 3, 1, 2];
  const ys = xs.toSorted((a, b) => a - b);
  return xs.join(",") + "|" + ys.join(",");
}

// Enough elements for several passes, checked in order.
export function many(n: number): number {
  const xs: number[] = [];
  let seed = Math.abs(Math.floor(n)) + 7;
  for (let i = 0; i < 300; i++) {
    seed = (seed * 48271) % 2147483647;
    xs.push(seed % 97);
  }
  xs.sort((a, b) => a - b);
  let ordered = 1;
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] > xs[i]) ordered = 0;
  return ordered * 1000 + xs.length;
}
