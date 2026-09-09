export const cases = [
  { call: "awaitOrdering", why: "statements after an await running later" },
  { call: "twoAwaitsInOrder", why: "two awaits resuming in order" },
  { call: "returnsAPromise", why: "an async return unwrapped once" },
  { call: "mapIndex", why: "an index carried through a loop over an array" },
  { call: "indexOfNaN", why: "indexOf using strict equality, so NaN is never found" },
  { call: "negativeSlice", why: "slice with a negative index" },
  { call: "codeUnitOrder", why: "string comparison by code unit" },
];
