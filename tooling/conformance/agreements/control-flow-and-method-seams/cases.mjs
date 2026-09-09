export const cases = [
  { call: "overrideThroughBase", why: "virtual dispatch through a base-typed call site" },
  { call: "finallyAfterReturn", why: "finally running after the return value is evaluated" },
  { call: "finallyOverridesReturn", why: "a return inside finally replacing the value" },
  { call: "closureCapturesTheBinding", why: "a closure capturing the binding, not the value" },
  { call: "perIterationBinding", why: "let giving each loop iteration its own binding" },
  { call: "shortCircuitSideEffect", why: "the right operand of && not being evaluated" },
  { call: "getterCalledEachRead", why: "a getter called on each read" },
  { call: "nearestCatch", why: "unwinding to the nearest catch" },
];
