/*---
description: "Direct literal control: Escaped user text passes through a generic record to build an exact literal-text matcher."
features: [ts-regexp-routes, ts-regexp-route-runtime-patterns, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing, ts-generics, ts-generic-constraints]
---*/
// Escaped user text passes through a generic record to build an exact literal-text matcher. Fresh direct literals preserve canonical metadata, captures, UTF-16 offsets and lastIndex.
type RuntimeRow = { choice: number; raw: string; text: string; expected: unknown[] };
const rows: RuntimeRow[] = [
  { choice: 0, raw: "a+b", text: "", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 0, raw: "a+b", text: "a+b", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "a+b", 2, true, "a+b", "string", "a+b", "string", "indices", true, "last", 0] },
  { choice: 0, raw: "a+b", text: "aaab", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 0, raw: "a+b", text: "😀a+b", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, raw: "a+b", text: "á", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 0, raw: "a+b", text: "\na+b", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, raw: "a+b", text: "\r\na+b", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 0, raw: "a+b", text: "\u2028a+b", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, raw: "a+b", text: "zzz", expected: ["^(a\\+b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 1, raw: "a.b", text: "", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, raw: "a.b", text: "a.b", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "a.b", 2, true, "a.b", "string", "a.b", "string", "indices", true, "last", 0] },   { choice: 1, raw: "a.b", text: "axb", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, raw: "a.b", text: "😀a.b", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 1, raw: "a.b", text: "á", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, raw: "a.b", text: "\na.b", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 1, raw: "a.b", text: "\r\na.b", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, raw: "a.b", text: "\u2028a.b", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 1, raw: "a.b", text: "zzz", expected: ["^(a\\.b)$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 2, raw: "[x]", text: "", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 2, raw: "[x]", text: "[x]", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "[x]", 2, true, "[x]", "string", "[x]", "string", "indices", true, "last", 0] },
  { choice: 2, raw: "[x]", text: "x", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 2, raw: "[x]", text: "😀[x]", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 2, raw: "[x]", text: "á", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 2, raw: "[x]", text: "\n[x]", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 2, raw: "[x]", text: "\r\n[x]", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },   { choice: 2, raw: "[x]", text: "\u2028[x]", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 2, raw: "[x]", text: "zzz", expected: ["^(\\[x\\])$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] }
];
for (const row of rows) for (const origin of [0, 1, 2]) {
  const pattern = row.choice === 0 ? /^(a\+b)$/u : row.choice === 1 ? /^(a\.b)$/u : /^(\[x\])$/u;
  const log: unknown[] = [pattern.source, pattern.flags, pattern.hasIndices, pattern.global, pattern.ignoreCase, pattern.multiline, pattern.dotAll, pattern.unicode, pattern.unicodeSets, pattern.sticky, pattern.lastIndex], found = pattern.exec(row.text);
  if (found === null) log.push("null"); else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined); for (const value of found) log.push(value, typeof value);
    const groups = found.groups; if (groups !== undefined) { assert.compareArray(Object.keys(groups), []); for (const name of []) log.push(name, groups[name], typeof groups[name]); }
    const indices = found.indices; log.push("indices", indices === undefined);
    if (indices !== undefined) { assert.sameValue(indices.length, found.length); for (let c = 0; c < found.length; c++) { const span = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
      const spans = indices.groups; if (spans !== undefined) { assert.compareArray(Object.keys(spans), []); for (const name of []) { const span = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); } } }
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
