/*---
description: "A RegExp field copied without overriding flags starts independent matching state."
features: [ts-regexp-routes, ts-regexp-route-runtime-patterns, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing, ts-interfaces]
---*/
// A RegExp field copied without a flags argument retains source and flags, but node gives the new object a zero cursor independent of its original.
type RuntimeRow = { text: string; expected: unknown[] };
const rows: RuntimeRow[] = [
  { text: "", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "null", "last", 0, "original-last", 0] },
  { text: "ab", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "match", 0, "ab", 3, false, "ab", "string", "a", "string", "b", "string", "letter", "a", "string", "indices", true, "last", 2, "original-last", 0] },
  { text: "A\n", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "null", "last", 0, "original-last", 0] },
  { text: "😀ab", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "match", 2, "😀ab", 3, false, "ab", "string", "a", "string", "b", "string", "letter", "a", "string", "indices", true, "last", 4, "copied", "null", "last", 0, "original-last", 4] },
  { text: "á", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "match", 0, "á", 3, false, "a", "string", "a", "string", undefined, "undefined", "letter", "a", "string", "indices", true, "last", 1, "original-last", 0] },
  { text: "\na", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "null", "last", 0, "original-last", 0] },
  { text: "\r\nab", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "match", 2, "\r\nab", 3, false, "ab", "string", "a", "string", "b", "string", "letter", "a", "string", "indices", true, "last", 4, "copied", "null", "last", 0, "original-last", 4] },
  { text: "\u2028a", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "null", "last", 0, "original-last", 0] },
  { text: "zzz", expected: ["same", false, "source", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 2, "copy", "(?<letter>a)(b)?", "gy", false, true, false, false, false, false, false, true, 0, "original", "null", "last", 0, "copied", "null", "last", 0, "original-last", 0] }
];
interface OriginalBox { pattern: RegExp }
function copyFrom(box: OriginalBox): RegExp { return new RegExp(box.pattern); }
for (const row of rows) for (const built of [false, true]) {
  const literal = /(?<letter>a)(b)?/gy, source: RegExp = built ? new RegExp(literal.source, literal.flags) : literal; source.lastIndex = 2;
  const copied = copyFrom({ pattern: source });
  const log: unknown[] = ["same", Object.is(source, copied), "source", source.source, source.flags, source.hasIndices, source.global, source.ignoreCase, source.multiline, source.dotAll, source.unicode, source.unicodeSets, source.sticky, source.lastIndex, "copy", copied.source, copied.flags, copied.hasIndices, copied.global, copied.ignoreCase, copied.multiline, copied.dotAll, copied.unicode, copied.unicodeSets, copied.sticky, copied.lastIndex];
  const first = source.exec(row.text); log.push("original");
  if (first === null) log.push("null"); else {
    log.push("match", first.index, first.input, first.length, first.groups === undefined); for (const value of first) log.push(value, typeof value);
    const groups = first.groups; if (groups !== undefined) { assert.compareArray(Object.keys(groups), ["letter"]); for (const name of ["letter"]) log.push(name, groups[name], typeof groups[name]); }
    const indices = first.indices; log.push("indices", indices === undefined);
    if (indices !== undefined) { assert.sameValue(indices.length, first.length); for (let c = 0; c < first.length; c++) { const span = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
      const spans = indices.groups; if (spans !== undefined) { assert.compareArray(Object.keys(spans), ["letter"]); for (const name of ["letter"]) { const span = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); } } }
  }
  log.push("last", source.lastIndex, "copied"); const second = copied.exec(row.text);
  if (second === null) log.push("null"); else {
    log.push("match", second.index, second.input, second.length, second.groups === undefined); for (const value of second) log.push(value, typeof value);
    const groups = second.groups; if (groups !== undefined) { assert.compareArray(Object.keys(groups), ["letter"]); for (const name of ["letter"]) log.push(name, groups[name], typeof groups[name]); }
    const indices = second.indices; log.push("indices", indices === undefined);
    if (indices !== undefined) { assert.sameValue(indices.length, second.length); for (let c = 0; c < second.length; c++) { const span = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
      const spans = indices.groups; if (spans !== undefined) { assert.compareArray(Object.keys(spans), ["letter"]); for (const name of ["letter"]) { const span = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); } } }
  }
  log.push("last", copied.lastIndex, "original-last", source.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
