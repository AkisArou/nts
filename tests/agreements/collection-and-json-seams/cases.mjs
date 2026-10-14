export const cases = [
  { call: "forOfOrder", why: "for...of visiting every element in order" },
  { call: "isArrayDiscriminates", why: "Array.isArray on an array and an object" },
  { call: "objectKeysOrder", why: "Object.keys in insertion order" },
  { call: "jsonStringifyFlat", why: "JSON.stringify of a flat object" },
  { call: "jsonDropsUndefined", why: "JSON.stringify dropping an absent field" },
  { call: "sortIsLexicographic", why: "sort being lexicographic by default" },
  { call: "sortWithComparator", why: "sort with a numeric comparator" },
  { call: "replaceFirstOnly", why: "replace substituting only the first occurrence" },
  { call: "joinWithSeparator", why: "join with a separator" },
  { call: "concatDoesNotMutate", why: "concat leaving the receiver alone" },
];
