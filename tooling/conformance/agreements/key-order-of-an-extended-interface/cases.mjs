export const cases = [
  {
    call: "baseFieldsWrittenFirst",
    why: "node orders own keys by insertion; the layout of an extended interface is derived-first",
  },
  {
    call: "derivedFieldWrittenFirst",
    why: "control: the same type written in the layout's order, which agrees",
  },
  { call: "aPlainLiteral", why: "control: no inheritance, so the layout is the literal's order" },
];
