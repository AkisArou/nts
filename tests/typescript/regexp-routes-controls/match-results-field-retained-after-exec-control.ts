/*---
description: "Direct literal control: A stored exec result survives the next call on its shared named-group expression."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-narrowing, ts-spread]
---*/
// Named global results are read immediately from fresh literals and retained only as scalar observations; node keeps the earlier captures and index unchanged.
type ResultRow = { text: string; start: number; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", start: 0, expected: ["first", "null", "last", 0, "second", "null", "last", 0, "retained", "null"] },
  { text: "ab a", start: 2, expected: ["first", "match", 0, "ab a", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string", "last", 2, "second", "match", 3, "ab a", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 4, "retained", "match", 0, "ab a", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string"] },
  { text: "za", start: 2, expected: ["first", "match", 1, "za", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 2, "second", "null", "last", 0, "retained", "match", 1, "za", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined"] },
  { text: "😀ab a", start: 4, expected: ["first", "match", 2, "😀ab a", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string", "last", 4, "second", "match", 5, "😀ab a", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 6, "retained", "match", 2, "😀ab a", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string"] },
  { text: "áa", start: 1, expected: ["first", "match", 0, "áa", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 1, "second", "match", 2, "áa", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 3, "retained", "match", 0, "áa", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined"] },
  { text: "\na", start: 2, expected: ["first", "match", 1, "\na", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 2, "second", "null", "last", 0, "retained", "match", 1, "\na", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined"] },
  { text: "\r\nab", start: 4, expected: ["first", "match", 2, "\r\nab", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string", "last", 4, "second", "null", "last", 0, "retained", "match", 2, "\r\nab", 3, false, "ab", "string", "a", "string", "b", "string", "head", "a", "string", "tail", "b", "string"] },
  { text: "\u2028a", start: 2, expected: ["first", "match", 1, "\u2028a", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined", "last", 2, "second", "null", "last", 0, "retained", "match", 1, "\u2028a", 3, false, "a", "string", "a", "string", undefined, "undefined", "head", "a", "string", "tail", undefined, "undefined"] },
  { text: "zzz", start: 0, expected: ["first", "null", "last", 0, "second", "null", "last", 0, "retained", "null"] }
];
for (const row of rows) for (const built of [false, true]) {
  const pattern = /(?<head>a)(?<tail>b)?/g; pattern.lastIndex = 0; const first = pattern.exec(row.text), saved: unknown[] = [];
  if (first === null) saved.push("null");
  else {
    saved.push("match", first.index, first.input, first.length, first.groups === undefined);
    for (let c = 0; c < first.length; c++) saved.push(first[c], typeof first[c]);
    const groups = first.groups; if (groups === undefined) throw new Test262Error("missing groups"); assert.compareArray(Object.keys(groups), ["head", "tail"]);
    for (const name of ["head", "tail"]) saved.push(name, groups[name], typeof groups[name]);
  }
  const log: unknown[] = ["first", ...saved, "last", pattern.lastIndex, "second"], direct = /(?<head>a)(?<tail>b)?/g; direct.lastIndex = row.start; const next = direct.exec(row.text);
  if (next === null) log.push("null");
  else {
    log.push("match", next.index, next.input, next.length, next.groups === undefined);
    for (let c = 0; c < next.length; c++) log.push(next[c], typeof next[c]);
    const groups = next.groups; if (groups === undefined) throw new Test262Error("missing groups"); assert.compareArray(Object.keys(groups), ["head", "tail"]);
    for (const name of ["head", "tail"]) log.push(name, groups[name], typeof groups[name]);
  }
  log.push("last", direct.lastIndex, "retained", ...saved); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
