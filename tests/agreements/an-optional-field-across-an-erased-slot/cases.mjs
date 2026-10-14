// What to call, and what each call is for. Every case takes nothing and answers
// a number, so the only thing crossing the boundary is a scalar.
export const cases = [
  { call: "optionalThroughErasedSlot", why: "the case: an optional field through an erased slot" },
  { call: "requiredThroughErasedSlot", why: "control: required instead of optional" },
  { call: "optionalThroughNullable", why: "control: optional, but no erasure" },
];
