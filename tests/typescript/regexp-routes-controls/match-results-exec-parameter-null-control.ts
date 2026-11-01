/*---
description: "Direct literal control: A nullable exec result from a RegExp parameter retains exact captures and index."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing]
---*/
// /(a)(b)?/ is fresh at the call site, with its nullable result read immediately; node preserves UTF-16 index and absent captures.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["null", "last", 0] },
  { text: "ab", expected: ["match", 0, "ab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0] },
  { text: "za", expected: ["match", 1, "za", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0] },
  { text: "😀ab", expected: ["match", 2, "😀ab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0] },
  { text: "á", expected: ["match", 0, "á", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0] },
  { text: "\na", expected: ["match", 1, "\na", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0] },
  { text: "\r\nab", expected: ["match", 2, "\r\nab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0] },
  { text: "\u2028a", expected: ["match", 1, "\u2028a", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0] },
  { text: "zzz", expected: ["null", "last", 0] }
];
for (const row of rows) for (const built of [false, true]) {
  const pattern = /(a)(b)?/;
  const found = pattern.exec(row.text), log: unknown[] = [];
  if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
  }
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
