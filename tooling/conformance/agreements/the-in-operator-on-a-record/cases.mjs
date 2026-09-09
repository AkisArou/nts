export const cases = [
  { call: "inPresent", why: "`in` on a key the record has" },
  { call: "inAbsent", why: "control: `in` on a key it does not have" },
  { call: "hasOwnPresent", why: "control: Object.hasOwn finds the same key" },
  { call: "readPresent", why: "control: reading the same key works" },
  { call: "keysLength", why: "control: Object.keys returns the same key" },
];
