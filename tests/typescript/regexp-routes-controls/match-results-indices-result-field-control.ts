/*---
description: "Direct literal control: Stored d-flag results preserve named indices, zero-length spans and undefined captures."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-tuples, ts-narrowing]
---*/
// /(?<head>a)(?<empty>b*)(?<optional>c)?/du result indices are read immediately at the direct call; node keeps UTF-16 spans, empty spans and absent spans distinct.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["null", "last", 0] },
  { text: "ab", expected: ["match", 0, "ab", 4, false, "ab", "string", "a", "string", "b", "string", undefined, "undefined", "head", "a", "string", "empty", "b", "string", "optional", undefined, "undefined", "indices", false, 0, false, 0, 2, 1, false, 0, 1, 2, false, 1, 2, 3, true, undefined, undefined, "head", false, 0, 1, "empty", false, 1, 2, "optional", true, undefined, undefined, "last", 0] },
  { text: "abc", expected: ["match", 0, "abc", 4, false, "abc", "string", "a", "string", "b", "string", "c", "string", "head", "a", "string", "empty", "b", "string", "optional", "c", "string", "indices", false, 0, false, 0, 3, 1, false, 0, 1, 2, false, 1, 2, 3, false, 2, 3, "head", false, 0, 1, "empty", false, 1, 2, "optional", false, 2, 3, "last", 0] },
  { text: "za", expected: ["match", 1, "za", 4, false, "a", "string", "a", "string", "", "string", undefined, "undefined", "head", "a", "string", "empty", "", "string", "optional", undefined, "undefined", "indices", false, 0, false, 1, 2, 1, false, 1, 2, 2, false, 2, 2, 3, true, undefined, undefined, "head", false, 1, 2, "empty", false, 2, 2, "optional", true, undefined, undefined, "last", 0] },
  { text: "😀ab", expected: ["match", 2, "😀ab", 4, false, "ab", "string", "a", "string", "b", "string", undefined, "undefined", "head", "a", "string", "empty", "b", "string", "optional", undefined, "undefined", "indices", false, 0, false, 2, 4, 1, false, 2, 3, 2, false, 3, 4, 3, true, undefined, undefined, "head", false, 2, 3, "empty", false, 3, 4, "optional", true, undefined, undefined, "last", 0] },
  { text: "á", expected: ["match", 0, "á", 4, false, "a", "string", "a", "string", "", "string", undefined, "undefined", "head", "a", "string", "empty", "", "string", "optional", undefined, "undefined", "indices", false, 0, false, 0, 1, 1, false, 0, 1, 2, false, 1, 1, 3, true, undefined, undefined, "head", false, 0, 1, "empty", false, 1, 1, "optional", true, undefined, undefined, "last", 0] },
  { text: "\na", expected: ["match", 1, "\na", 4, false, "a", "string", "a", "string", "", "string", undefined, "undefined", "head", "a", "string", "empty", "", "string", "optional", undefined, "undefined", "indices", false, 0, false, 1, 2, 1, false, 1, 2, 2, false, 2, 2, 3, true, undefined, undefined, "head", false, 1, 2, "empty", false, 2, 2, "optional", true, undefined, undefined, "last", 0] },
  { text: "\r\nabc", expected: ["match", 2, "\r\nabc", 4, false, "abc", "string", "a", "string", "b", "string", "c", "string", "head", "a", "string", "empty", "b", "string", "optional", "c", "string", "indices", false, 0, false, 2, 5, 1, false, 2, 3, 2, false, 3, 4, 3, false, 4, 5, "head", false, 2, 3, "empty", false, 3, 4, "optional", false, 4, 5, "last", 0] },
  { text: "\u2028a", expected: ["match", 1, "\u2028a", 4, false, "a", "string", "a", "string", "", "string", undefined, "undefined", "head", "a", "string", "empty", "", "string", "optional", undefined, "undefined", "indices", false, 0, false, 1, 2, 1, false, 1, 2, 2, false, 2, 2, 3, true, undefined, undefined, "head", false, 1, 2, "empty", false, 2, 2, "optional", true, undefined, undefined, "last", 0] },
  { text: "zzz", expected: ["null", "last", 0] }
];
for (const row of rows) for (const built of [false, true]) {
  const pattern = /(?<head>a)(?<empty>b*)(?<optional>c)?/du;
  const found = pattern.exec(row.text), log: unknown[] = [];
  if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
    const groups = found.groups; if (groups === undefined) throw new Test262Error("missing groups"); assert.compareArray(Object.keys(groups), ["head", "empty", "optional"]);
    for (const name of ["head", "empty", "optional"]) log.push(name, groups[name], typeof groups[name]);
    const indices = found.indices; log.push("indices", indices === undefined); if (indices === undefined) throw new Test262Error("missing indices"); assert.sameValue(indices.length, found.length);
    for (let c = 0; c < found.length; c++) { const span: [number, number] | undefined = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
    const spans = indices.groups; if (spans === undefined) throw new Test262Error("missing named indices"); assert.compareArray(Object.keys(spans), ["head", "empty", "optional"]);
    for (const name of ["head", "empty", "optional"]) { const span: [number, number] | undefined = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
