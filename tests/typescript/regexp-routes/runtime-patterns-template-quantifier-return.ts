/*---
description: "Typed template pieces build a named repeated atom through a RegExp return."
features: [ts-regexp-routes, ts-regexp-route-runtime-patterns, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing, ts-interfaces]
---*/
// Typed template pieces build a named repeated atom through a RegExp return. Node preserves canonical metadata, captures, UTF-16 offsets and lastIndex.
type RuntimeRow = { choice: number; atom: string; count: number; text: string; expected: unknown[] };
const rows: RuntimeRow[] = [
  { choice: 0, atom: "ab", count: 2, text: "", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "ab", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "ab", 2, false, "ab", "string", "ab", "string", "word", "ab", "string", "indices", true, "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "A\n", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "😀ab", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "á", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "\na", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "\r\nab", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "\u2028a", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "zzz", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "abab", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "abab", 2, false, "abab", "string", "ab", "string", "word", "ab", "string", "indices", true, "last", 0] },
  { choice: 0, atom: "ab", count: 2, text: "ababab", expected: ["^(?<word>ab){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "ab", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "A\n", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "😀ab", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "á", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "á", 2, false, "á", "string", "á", "string", "word", "á", "string", "indices", true, "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "\na", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "\r\nab", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "\u2028a", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "zzz", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "áá", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "match", 0, "áá", 2, false, "áá", "string", "á", "string", "word", "á", "string", "indices", true, "last", 0] },
  { choice: 1, atom: "á", count: 2, text: "ááá", expected: ["^(?<word>á){1,2}$", "u", false, false, false, false, false, true, false, false, 0, "null", "last", 0] }
];
interface TemplateParts { atom: string; count: number }
function construct(parts: TemplateParts): RegExp { return new RegExp(`^(?<word>${parts.atom}){1,${parts.count}}$`, "u"); }
for (const row of rows) for (const origin of [0, 1, 2]) {
  const literal = row.choice === 0 ? /^(?<word>ab){1,2}$/u : /^(?<word>á){1,2}$/u;
  const pattern: RegExp = origin === 0 ? literal : origin === 1 ? new RegExp(literal.source, literal.flags) : construct(row);
  const log: unknown[] = [pattern.source, pattern.flags, pattern.hasIndices, pattern.global, pattern.ignoreCase, pattern.multiline, pattern.dotAll, pattern.unicode, pattern.unicodeSets, pattern.sticky, pattern.lastIndex], found = pattern.exec(row.text);
  if (found === null) log.push("null"); else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined); for (const value of found) log.push(value, typeof value);
    const groups = found.groups; if (groups !== undefined) { assert.compareArray(Object.keys(groups), ["word"]); for (const name of ["word"]) log.push(name, groups[name], typeof groups[name]); }
    const indices = found.indices; log.push("indices", indices === undefined);
    if (indices !== undefined) { assert.sameValue(indices.length, found.length); for (let c = 0; c < found.length; c++) { const span = indices[c]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(c, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); }
      const spans = indices.groups; if (spans !== undefined) { assert.compareArray(Object.keys(spans), ["word"]); for (const name of ["word"]) { const span = spans[name]; if (span !== undefined) assert.sameValue(span.length, 2); log.push(name, span === undefined, span === undefined ? undefined : span[0], span === undefined ? undefined : span[1]); } } }
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
