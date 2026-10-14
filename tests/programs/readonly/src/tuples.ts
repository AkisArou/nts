// A tuple has fixed arity, which is what lets it be laid out flat instead of as
// a pointer and a length the way an array must be.
export const pair: [number, string] = [1, "a"];
export const frozenPair: readonly [number, boolean] = [1, true];
