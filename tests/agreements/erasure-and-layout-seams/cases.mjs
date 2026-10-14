export const cases = [
  { call: "derivedThroughBase", why: "a derived instance read through its base" },
  { call: "derivedFieldAfterUpcast", why: "the derived field after a base-typed slot" },
  { call: "twoRequiredThroughErased", why: "two required fields through an erased slot" },
  { call: "optionalPresent", why: "an optional field that is present" },
  { call: "optionalAbsent", why: "an optional field that is absent" },
  { call: "narrowingAcrossAssignment", why: "a narrowing outliving its branch" },
  { call: "arrayThroughWiderSlot", why: "an array read through a structural slot" },
];
