export const cases = [
  { call: "popReturnsLast", why: "pop returning the last and shortening" },
  { call: "shiftReturnsFirst", why: "shift returning the first and shortening" },
  { call: "unshiftPrepends", why: "unshift prepending and returning the new length" },
  { call: "spliceRemoves", why: "splice removing and returning what it removed" },
  { call: "sliceIsACopy", why: "slice being a copy rather than a view" },
  { call: "reverseInPlace", why: "reverse mutating in place and returning the receiver" },
  { call: "indexOfFirst", why: "indexOf finding the first occurrence" },
  { call: "lastIndexOfLast", why: "lastIndexOf finding the last" },
  { call: "includesFinds", why: "includes finding a value" },
  { call: "popEmpty", why: "pop on an empty array" },
  { call: "fillRange", why: "fill writing a range" },
];
