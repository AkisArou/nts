export const cases = [
  { call: "methodShadowing", why: "a derived method shadowing the base" },
  { call: "superReachesBase", why: "super reaching the base method" },
  { call: "inheritedField", why: "an inherited field on the derived instance" },
  { call: "objectAssignCopies", why: "Object.assign copying own enumerable properties" },
  { call: "objectAssignLaterWins", why: "a later source in Object.assign winning" },
  { call: "deleteRemoves", why: "delete removing an own property" },
  { call: "hasOwnFindsOwn", why: "Object.hasOwn on an own property" },
  { call: "absentKeyIsUndefined", why: "an absent key reading as undefined" },
  { call: "objectEntriesPairs", why: "Object.entries pairing keys with values" },
];
