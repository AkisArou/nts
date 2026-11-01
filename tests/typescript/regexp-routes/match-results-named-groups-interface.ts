/*---
description: "A declared named-group interface preserves empty, absent and inactive captures."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-index-signatures, ts-narrowing]
---*/
// Four named groups cross an index-signature interface; node distinguishes participating empty captures from inactive alternatives and optional groups.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["null", "last", 0] },
  { text: "ab", expected: ["match", 0, "ab", 5, false, "ab", "string", "a", "string", "b", "string", undefined, "undefined", undefined, "undefined", "head", "a", "string", "tail", "b", "string", "other", undefined, "undefined", "absent", undefined, "undefined", "last", 0] },
  { text: "a", expected: ["match", 0, "a", 5, false, "a", "string", "a", "string", "", "string", undefined, "undefined", undefined, "undefined", "head", "a", "string", "tail", "", "string", "other", undefined, "undefined", "absent", undefined, "undefined", "last", 0] },
  { text: "c", expected: ["match", 0, "c", 5, false, "c", "string", undefined, "undefined", undefined, "undefined", "c", "string", undefined, "undefined", "head", undefined, "undefined", "tail", undefined, "undefined", "other", "c", "string", "absent", undefined, "undefined", "last", 0] },
  { text: "cd", expected: ["match", 0, "cd", 5, false, "cd", "string", undefined, "undefined", undefined, "undefined", "c", "string", "d", "string", "head", undefined, "undefined", "tail", undefined, "undefined", "other", "c", "string", "absent", "d", "string", "last", 0] },
  { text: "😀a", expected: ["match", 2, "😀a", 5, false, "a", "string", "a", "string", "", "string", undefined, "undefined", undefined, "undefined", "head", "a", "string", "tail", "", "string", "other", undefined, "undefined", "absent", undefined, "undefined", "last", 0] },
  { text: "á", expected: ["match", 0, "á", 5, false, "a", "string", "a", "string", "", "string", undefined, "undefined", undefined, "undefined", "head", "a", "string", "tail", "", "string", "other", undefined, "undefined", "absent", undefined, "undefined", "last", 0] },
  { text: "\na", expected: ["match", 1, "\na", 5, false, "a", "string", "a", "string", "", "string", undefined, "undefined", undefined, "undefined", "head", "a", "string", "tail", "", "string", "other", undefined, "undefined", "absent", undefined, "undefined", "last", 0] },
  { text: "\r\nc", expected: ["match", 2, "\r\nc", 5, false, "c", "string", undefined, "undefined", undefined, "undefined", "c", "string", undefined, "undefined", "head", undefined, "undefined", "tail", undefined, "undefined", "other", "c", "string", "absent", undefined, "undefined", "last", 0] },
  { text: "\u2028cd", expected: ["match", 1, "\u2028cd", 5, false, "cd", "string", undefined, "undefined", undefined, "undefined", "c", "string", "d", "string", "head", undefined, "undefined", "tail", undefined, "undefined", "other", "c", "string", "absent", "d", "string", "last", 0] },
  { text: "zzz", expected: ["null", "last", 0] }
];
interface NamedCaptures { [name: string]: string | undefined }
function appendNames(groups: NamedCaptures, log: unknown[]): void { for (const name of ["head", "tail", "other", "absent"]) log.push(name, groups[name], typeof groups[name]); }
for (const row of rows) for (const built of [false, true]) {
  const literal = /(?<head>a)(?<tail>b?)|(?<other>c)(?<absent>d)?/, pattern: RegExp = built ? new RegExp(literal.source, literal.flags) : literal;
  const found = pattern.exec(row.text), log: unknown[] = [];
  if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
    const groups: NamedCaptures | undefined = found.groups; if (groups === undefined) throw new Test262Error("missing groups"); assert.compareArray(Object.keys(groups), ["head", "tail", "other", "absent"]);
    appendNames(groups, log);
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
