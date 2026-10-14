export const cases = [
  { call: "optionalNumberPresent", why: "the known point, restated" },
  { call: "optionalNumberAbsent", why: "the optional field absent from the literal" },
  { call: "optionalStringPresent", why: "a string field rather than a number" },
  { call: "twoOptionalPresent", why: "two optional fields, both present" },
  { call: "mixedOptionalAndRequired", why: "one optional beside one required" },
  { call: "mixedRequiredOnly", why: "the required field of a mixed struct" },
];
