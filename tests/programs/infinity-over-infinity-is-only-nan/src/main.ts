// `Infinity / Infinity` is NaN in every sign combination, and nothing else.
//
// Its fact was spelled `{lo: inf, hi: -inf, whole: false, maybe_nan}` while
// every join of a set with no numeric member spells it `whole: true`. Joining
// that fact with itself changed it, so flow's monotone `slot.join(computed)`
// stopped at a fact a second visit would rewrite, and with debug assertions
// on (the `nts-dev` profile) the full-sweep check panicked with "flow fixpoint
// changed on a full sweep". Release builds compile the check out and kept the
// unconverged spelling.
//
// The arms mirror the three test262 cases that found it (#849, #492):
// `S11.5.2_A4_T4` divides the four signed infinities under `isNaN`;
// `harness/nans.js` builds a module-scope array of NaN expressions;
// `nan-equivalence-define-own-property-reassign` writes those NaNs into a
// property. Literal operands, so the quotient is the analysis's to know.
//
// Control: `infinity-over-a-finite-divisor-is-a-number`, the same arms with a
// finite divisor.

const nans = [NaN, 0 / 0, Infinity / Infinity, -(Infinity / Infinity)];

/** The four signed quotients of `S11.5.2_A4_T4`. */
export function everySignedQuotientIsNaN(n: number): number {
  let count = 0;
  if (isNaN(Number.NEGATIVE_INFINITY / Number.NEGATIVE_INFINITY)) count++;
  if (isNaN(Number.POSITIVE_INFINITY / Number.POSITIVE_INFINITY)) count++;
  if (isNaN(Number.NEGATIVE_INFINITY / Number.POSITIVE_INFINITY)) count++;
  if (isNaN(Number.POSITIVE_INFINITY / Number.NEGATIVE_INFINITY)) count++;
  return count + n;
}

/** `harness/nans.js`: every entry of a module-scope list of NaNs. */
export function aModuleScopeListHoldsOnlyNaN(n: number): number {
  let count = 0;
  for (const value of nans) {
    if (value !== value) count++;
  }
  return count + n;
}

class Holder {
  value = 1;
}

/** `nan-equivalence-define-own-property-reassign`: a property given each NaN. */
export function aPropertyReassignedWithEachNaN(n: number): number {
  const holder = new Holder();
  let count = 0;
  for (const value of nans) {
    holder.value = value;
    if (isNaN(holder.value)) count++;
  }
  holder.value = Infinity / Infinity;
  return count + (isNaN(holder.value) ? 1 : 0) + n;
}
