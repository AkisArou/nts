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
