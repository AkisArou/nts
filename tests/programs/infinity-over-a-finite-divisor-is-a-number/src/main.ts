// The control for `infinity-over-infinity-is-only-nan`: the same arms with a
// finite divisor, so every quotient is an ordinary number -- an infinity --
// rather than a set holding only NaN. It compiled and agreed with node before
// that fixture's fix as well as after.

const quotients = [1, 0 / 2, Infinity / 2, -(Infinity / 2)];

/** The four signed quotients, each over a finite divisor. */
export function noSignedQuotientIsNaN(n: number): number {
  let count = 0;
  if (isNaN(Number.NEGATIVE_INFINITY / -2)) count++;
  if (isNaN(Number.POSITIVE_INFINITY / 2)) count++;
  if (isNaN(Number.NEGATIVE_INFINITY / 2)) count++;
  if (isNaN(Number.POSITIVE_INFINITY / -2)) count++;
  return count + n;
}

/** A module-scope list with no NaN in it. */
export function aModuleScopeListHoldsNoNaN(n: number): number {
  let count = 0;
  for (const value of quotients) {
    if (value !== value) count++;
  }
  return count + n;
}

class Holder {
  value = 1;
}

/** A property given each quotient. */
export function aPropertyReassignedWithEachQuotient(n: number): number {
  const holder = new Holder();
  let count = 0;
  for (const value of quotients) {
    holder.value = value;
    if (isNaN(holder.value)) count++;
  }
  holder.value = Infinity / 2;
  return count + (isNaN(holder.value) ? 1 : 0) + n;
}
