export const cases = [
  { call: "throwInPlace", why: "control: a throw in the try's own body, which is caught" },
  { call: "throwAcrossAnArrow", why: "a throw from a called arrow" },
  { call: "throwAcrossANestedFunction", why: "a throw from a called nested function" },
  { call: "throwAcrossATopLevelFunction", why: "a throw from a called top-level function" },
];
