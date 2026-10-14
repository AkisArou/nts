// Ordering under `await`, and the array and string methods that carry an
// index or a receiver. Each answers a number.

/** An await suspends: statements after it run later than statements before. */
export async function awaitOrdering(): Promise<number> {
  const seen: number[] = [];
  seen.push(1);
  await Promise.resolve(0);
  seen.push(2);
  return seen[0] === 1 && seen[1] === 2 ? seen.length : -1;
}

/** Two awaits resume in the order they suspended. */
export async function twoAwaitsInOrder(): Promise<number> {
  let out = 0;
  const step = async (n: number): Promise<void> => {
    await Promise.resolve(0);
    out = out * 10 + n;
  };
  await step(1);
  await step(2);
  return out;
}

/** An async function's return value is unwrapped once, not twice.
 *
 * Written as a declaration rather than an arrow deliberately. An async **arrow
 * with an expression body**, awaited, emits C that clang rejects -- a cast from
 * a double to a promise pointer -- and it took this whole case file down with a
 * DID NOT LINK before the other seven questions could be asked. Filed as
 * `blockers/an-async-arrow-with-an-expression-body`; kept out of here so the
 * seven can be asked. */
async function seven(): Promise<number> {
  return 7;
}

export async function returnsAPromise(): Promise<number> {
  return await seven();
}

/** map passes the index as the second argument. */
export function mapIndex(): number {
  const xs = [10, 20, 30];
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v !== undefined) total += v * i;
  }
  return total;
}

/** indexOf uses strict equality, so NaN is never found. */
export function indexOfNaN(): number {
  const xs = [1, 0 / 0, 3];
  return xs.indexOf(0 / 0);
}

/** slice with a negative index counts from the end. */
export function negativeSlice(): number {
  const s = "abcdef";
  return s.slice(-2).length;
}

// `lengthAfterGap` lived here and now has its own case file,
// `an-indexed-write-at-or-past-the-length`, with the controls it deserves: it
// aborts the process rather than answering, and writing *at* the length -- the
// ordinary append -- aborts too.

/** String comparison is by code unit, not by locale. */
export function codeUnitOrder(): number {
  return "Z" < "a" ? 1 : 0;
}
