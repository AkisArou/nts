// A sort comparator that throws, with the handler outside the sort.
// Comparator calls start in the uniform ABI; the raising slot preserves the
// handled throw. Preparation may resolve the selected entry by name. A known
// ordinary comparator recovers its typed body only after argument admission
// is proved. The core test checks both stages and the descriptor's target.

function fussy(a: number, b: number): number {
  if (a > 6 || b > 6) {
    throw new RangeError("too big to compare");
  }
  return a - b;
}

function plain(a: number, b: number): number {
  return a - b;
}

/**
 * The `try` directly around the sort, and the comparator throws for an element
 * above 6 -- so the low arms sort and the high ones are caught.
 */
export function directlyAroundTheSort(n: number): number {
  const items = [3, 1, 2, n & 15];
  try {
    return items.sort(fussy)[0]!;
  } catch {
    return -1;
  }
}

/**
 * **The control, and it is the arm that says what the variable is**: the same sort,
 * the same `try`, a comparator that cannot throw. It must keep ordering, and it is
 * what catches a repair that makes every sort refuse or every sort wrong.
 */
export function withAQuietComparator(n: number): number {
  const items = [3, 1, 2, n & 15];
  try {
    return items.sort(plain)[0]!;
  } catch {
    return -1;
  }
}

class Jar {
  items: number[] = [3, 1, 2];
  smallest(): number {
    return this.items.slice().sort(fussy)[0]!;
  }
}

/** The same comparator without a try. The typed direct call must be recovered
 * during preparation. Inputs stay below its throwing threshold so every case
 * compares; this control measures dispatch, not uncaught termination. */
export function outsideATry(n: number): number {
  const items = [3, 1, 2, n & 3];
  return items.sort(fussy)[0]!;
}

/**
 * One frame down: the `try` is around a method, and the sort is inside the method's
 * *raising copy*. This is the shape the JVM lane found, and the one the ordinary
 * body's devirtualization used to hide.
 */
export function throughAMethod(n: number): number {
  const jar = new Jar();
  jar.items.push(n & 15);
  try {
    return jar.smallest();
  } catch {
    return -1;
  }
}
