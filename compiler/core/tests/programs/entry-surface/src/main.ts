// What a single-entry artifact publishes, and what it does not.
//
// `Roots::EntrySurface` is `EveryExport` without the `exported` flag. Dropping
// that flag is the point -- a helper a sibling module imports is not part of a
// `.so`'s ABI -- and it also dropped the *methods of an exported class*, which
// are functions named `Counter#bump` and match no entry in `public_api`. A Java
// consumer got a class it could construct and could not call.

export class Counter {
  private n: number = 0;

  bump(): number {
    this.n = this.n + 1;
    return this.n;
  }

  /** A second member, so the fix cannot be "the first one happens to survive". */
  reset(): number {
    this.n = 0;
    return this.n;
  }
}

/** Not exported, so nothing outside can reach it however it is built. */
class Hidden {
  secret(): number {
    return 7;
  }
}

export function published(x: number): number {
  return x + 1;
}

/** Not exported and called by nothing. */
function unreachable(x: number): number {
  return x + 99;
}

/** Keeps `Hidden` from being dead for a reason other than the one under test:
 *  it is constructed, so only the *root set* decides whether it survives. */
export function buildsAHidden(x: number): number {
  const hidden = new Hidden();
  return x + (hidden === null ? 1 : 0);
}

// **A callback-taking export and a caller that passes one**, which together are
// what produce an `eachUpTo#Closure0` specialization. The first version of the
// fix rooted anything whose name had a `#` and whose owner was published --
// which is true of that specialization, since `eachUpTo` is exported -- and
// keeping it past the point its call sites were rewritten left the verifier
// reporting `Unreachable` on both the original and the clone.
//
// Either half alone is fine, so both are here.
export function eachUpTo(n: number, f: (x: number) => void): void {
  for (let i = 0; i < n; i++) {
    f(i);
  }
}

export function triangle(n: number): number {
  let total = 0;
  eachUpTo(n, (x: number): void => {
    total = total + x;
  });
  return total;
}
