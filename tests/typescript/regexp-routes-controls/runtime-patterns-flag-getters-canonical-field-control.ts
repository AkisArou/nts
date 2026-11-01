/*---
description: "Direct literal control: Typed flag text in noncanonical order constructs a matcher stored in a declared field."
features: [ts-regexp-routes, ts-regexp-route-runtime-patterns, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing, ts-interfaces, ts-unions, ts-literal-types]
---*/
// Typed flag text in noncanonical order constructs a matcher stored in a declared field. Fresh direct literals preserve canonical metadata, captures, UTF-16 offsets and lastIndex.
type RuntimeRow = { choice: number; flags: "yusmigd" | "yvsmigd"; text: string; expected: unknown[] };
const rows: RuntimeRow[] = [
  { choice: 0, flags: "yusmigd", text: "", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 0, flags: "yusmigd", text: "ab", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "match", 0, "ab", 3, false, "ab", "string", "a", "string", "b", "string", "first", "a", "string", "indices", false, 0, false, 0, 2, 1, false, 0, 1, 2, false, 1, 2, "first", false, 0, 1, "last", 2] },
  { choice: 0, flags: "yusmigd", text: "A\n", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "match", 0, "A\n", 3, false, "A", "string", "A", "string", undefined, "undefined", "first", "A", "string", "indices", false, 0, false, 0, 1, 1, false, 0, 1, 2, true, undefined, undefined, "first", false, 0, 1, "last", 1] },
  { choice: 0, flags: "yusmigd", text: "😀ab", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 0, flags: "yusmigd", text: "á", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "match", 0, "á", 3, false, "a", "string", "a", "string", undefined, "undefined", "first", "a", "string", "indices", false, 0, false, 0, 1, 1, false, 0, 1, 2, true, undefined, undefined, "first", false, 0, 1, "last", 1] },
  { choice: 0, flags: "yusmigd", text: "\na", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 0, flags: "yusmigd", text: "\r\nab", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 0, flags: "yusmigd", text: "\u2028a", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 0, flags: "yusmigd", text: "zzz", expected: ["(?<first>a)(b)?", "dgimsuy", true, true, true, true, true, true, false, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "ab", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "match", 0, "ab", 3, false, "ab", "string", "a", "string", "b", "string", "first", "a", "string", "indices", false, 0, false, 0, 2, 1, false, 0, 1, 2, false, 1, 2, "first", false, 0, 1, "last", 2] },
  { choice: 1, flags: "yvsmigd", text: "A\n", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "match", 0, "A\n", 3, false, "A", "string", "A", "string", undefined, "undefined", "first", "A", "string", "indices", false, 0, false, 0, 1, 1, false, 0, 1, 2, true, undefined, undefined, "first", false, 0, 1, "last", 1] },
  { choice: 1, flags: "yvsmigd", text: "😀ab", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "á", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "match", 0, "á", 3, false, "a", "string", "a", "string", undefined, "undefined", "first", "a", "string", "indices", false, 0, false, 0, 1, 1, false, 0, 1, 2, true, undefined, undefined, "first", false, 0, 1, "last", 1] },
  { choice: 1, flags: "yvsmigd", text: "\na", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "\r\nab", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "\u2028a", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] },
  { choice: 1, flags: "yvsmigd", text: "zzz", expected: ["(?<first>a)(b)?", "dgimsvy", true, true, true, true, true, false, true, true, 0, "null", "last", 0] }
];
for (const row of rows) for (const origin of [0, 1, 2]) {
  const pattern = row.choice === 0 ? /(?<first>a)(b)?/dgimsuy : /(?<first>a)(b)?/dgimsvy;
  const log: unknown[] = [pattern.source, pattern.flags, pattern.hasIndices, pattern.global, pattern.ignoreCase, pattern.multiline, pattern.dotAll, pattern.unicode, pattern.unicodeSets, pattern.sticky, pattern.lastIndex], found = pattern.exec(row.text);
  if (found === null) log.push("null"); else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined); for (const value of found) log.push(value, typeof value);
    const groups = found.groups; if (groups !== undefined) { assert.compareArray(Object.keys(groups), ["first"]); for (const name of ["first"]) log.push(name, groups[name], typeof groups[name]); }
    const indices = found.indices; log.push("indices", indices === undefined);
    if (indices !== undefined) { assert.sameValue(indices.length, found.length); for (let c = 0; c < found.length; c++) { const span = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
      const spans = indices.groups; if (spans !== undefined) { assert.compareArray(Object.keys(spans), ["first"]); for (const name of ["first"]) { const span = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); } } }
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
