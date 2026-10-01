// A method's raising copy sorting with a comparator that never throws.
//
// `smallest()` sorts with `ascending`, a plain function passed as a value, and
// is called inside a `try`, so it has a raising copy, `Jar#smallest@raises`.
// Outside a `try`, `closure_callee` calls the comparator's written entry by name;
// in the copy it names the uniform raising slot. Until a5efcf78a `lower_sort_with`
// passed the comparator's *written* arguments whichever entry was chosen. On C
// the call went through an empty table entry and the sort did not order (5 where
// node says 1); the JVM refused the copy. Found on the JVM first, from
// web-platform's `CookieJar#evict@raises`, and an outcomes record from bdd7575c8.
//
// `examples/a-throwing-sort-comparator-inside-a-try` has the same frame with a
// comparator that throws; this is the quiet one, which is what `evict` is.
// `unguarded` is the control: the same call with the handler removed, which
// builds no raising copy.
function ascending(a: number, b: number): number {
  return a - b;
}

class Jar {
  items: number[] = [3, 1, 2];
  smallest(): number {
    const sorted = this.items.slice().sort(ascending);
    return sorted[0]!;
  }
}

export function guarded(n: number): number {
  const jar = new Jar();
  jar.items.push(n & 15);
  try {
    return jar.smallest();
  } catch {
    return -1;
  }
}

export function unguarded(n: number): number {
  const jar = new Jar();
  jar.items.push(n & 15);
  return jar.smallest();
}
