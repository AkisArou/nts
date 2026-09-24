// The types the census has to tell apart, declared in the *other* file.
//
// Deliberately not beside their uses: "is this receiver's type an interface"
// goes through the symbol's declarations, and an import names an alias that
// carries none of them. A one-file fixture cannot tell a census that follows the
// alias from one that happens to be looking at the declaration already.

/** Every member a field, so each counting rule gets its own name to assert on. */
export interface Named {
  forDots: string;
  forKeys: string;
  forOne: string;
  forTwo: string;
  forStrings: string;
  forWriting: number;
  forCompound: number;
}

/** A field, a method and an accessor, which are three different answers. */
export interface Mixed {
  stored: number;
  describe(): string;
  get derived(): number;
}

/** A table: its keys are not known at compile time, so it has no fixed offset. */
export interface Keyed {
  [key: string]: number;
}

/** Nothing implements it, and no class covers its members either. */
export interface Uninhabitable {
  nobodyHasThis: string;
}

/** Named in an `implements` clause below. */
export interface Declared {
  declaredField: number;
}

/** A value, so the other file can import this module as a namespace. */
export const LIMIT = 41;

/**
 * Two classes cover it and neither says so, so a chain through it is three arms:
 * the interface's own layout, which an object literal written at it gets, plus
 * one per class.
 *
 * The coverers put `coveredTwice` at three different indices between them, which
 * is the whole reason the arms cannot share one.
 */
export interface TwoCoverers {
  coveredTwice: string;
}

/**
 * Every member optional, so a comparison of *required* names has nothing to
 * compare and finds no coverer -- and `Opting` says `implements` anyway.
 *
 * This is the arm a name-coverage rule alone misses, and a chain that misses an
 * arm aborts a correct program. The `arms` column's own `1` row found the bug.
 */
export interface OnlyOptional {
  perhaps?: number;
}
