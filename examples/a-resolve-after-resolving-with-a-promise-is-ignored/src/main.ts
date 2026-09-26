// `resolve(p)` with a promise, then a second `resolve` or `reject`: the second
// is ignored, although the promise is still pending.
//
// The specification gives each pair of resolving functions one shared
// `alreadyResolved` flag, and it is not the same as being settled. `resolve(p)`
// spends the pair and leaves the promise pending until `p` settles; anything
// either function is called with after that is ignored. The runtime's settle
// helpers refused only a promise that had *settled*, so this compiler answered
// the second call: `lockedIn` fulfilled with `n` where node waits for `later`,
// and `rejectAfter` rejected where node fulfils. 57 of 58 cases disagreed and
// nothing refused.
//
// `nts_promise_claim` is the flag, counted per promise -- see its comment for
// why that is the spec's flag per pair. Every settler call reaches it through
// `lower_settler_call`, whichever way the settler was named, so the arms below
// are the three ways of naming one: an executor parameter, a closure's
// capture of one, and `Promise.withResolvers`. `twoValues` is the control: its
// first call settles, so the old helpers already ignored the second, and it
// agrees under either compiler.
//
// Transcribed from node (v24): each export called with 0 and 3.
//
//     capturedThenResolved 103    lockedIn 103          rejectAfter 10
//     twoValues 3                 withResolversPair 3   (for n = 3)
//
// `withResolversPair` answers `n`: `resolve(settledNow)` locks it in to a
// promise that is already fulfilled with `n`, and the `resolve(-1)` after it
// is ignored.

/** `resolve(later)` locks the promise in; a later `resolve(n)` is ignored. */
export async function lockedIn(n: number): Promise<number> {
  const later = new Promise<number>((resolve) => {
    setTimeout(() => resolve(n + 100), 0);
  });
  return await new Promise<number>((resolve) => {
    resolve(later);
    resolve(n);
  });
}

/** `reject` after `resolve(inner)` is ignored too: one flag, shared. */
export async function rejectAfter(n: number): Promise<number> {
  const inner = Promise.resolve(n + 7);
  try {
    return await new Promise<number>((resolve, reject) => {
      resolve(inner);
      reject(new Error("late"));
    });
  } catch {
    return -1;
  }
}

/** The second call made through a closure that captured the settler. */
export async function capturedThenResolved(n: number): Promise<number> {
  const later = new Promise<number>((resolve) => {
    setTimeout(() => resolve(n + 100), 0);
  });
  return await new Promise<number>((resolve) => {
    const again = (v: number): void => {
      resolve(v);
    };
    resolve(later);
    again(n);
  });
}

/** The same flag on the pair `Promise.withResolvers` hands out. */
export async function withResolversPair(n: number): Promise<number> {
  const settledNow = Promise.resolve(n);
  const { promise, resolve } = Promise.withResolvers<number>();
  resolve(settledNow);
  resolve(-1);
  return await promise;
}

/** Control: the first call settles, so the second was already ignored. */
export async function twoValues(n: number): Promise<number> {
  return await new Promise<number>((resolve) => {
    resolve(n);
    resolve(n + 1);
  });
}
