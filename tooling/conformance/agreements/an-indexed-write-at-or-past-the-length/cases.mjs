export const cases = [
  { call: "writePastTheEnd", why: "a write past the end, which node grows into" },
  { call: "writeAtTheLength", why: "a write at exactly the length -- the ordinary append" },
  { call: "pushInstead", why: "control: the other spelling of append" },
  { call: "writeInsideTheBounds", why: "control: a write inside the bounds" },
];
