/*---
description: "Direct literal control: Named exec results retain input-specific captures through a typed Map and later reads."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-narrowing]
---*/
// Alternative named captures from separate inputs are read directly from a fresh literal; scalar observations are stored for later comparison; node retains each input, index and undefined inactive group.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["null", "last", 0] },
  { text: "ab", expected: ["match", 0, "ab", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "za", expected: ["match", 1, "za", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "😀ab", expected: ["match", 2, "😀ab", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "á", expected: ["match", 0, "á", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "\na", expected: ["match", 1, "\na", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "\r\nab", expected: ["match", 2, "\r\nab", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "\u2028a", expected: ["match", 1, "\u2028a", 3, false, "a", "string", "a", "string", undefined, "undefined", "left", "a", "string", "right", undefined, "undefined", "last", 0] },
  { text: "zzz", expected: ["null", "last", 0] },
  { text: "b", expected: ["match", 0, "b", 3, false, "b", "string", undefined, "undefined", "b", "string", "left", undefined, "undefined", "right", "b", "string", "last", 0] },
  { text: "zb", expected: ["match", 1, "zb", 3, false, "b", "string", undefined, "undefined", "b", "string", "left", undefined, "undefined", "right", "b", "string", "last", 0] }
];
for (const built of [false, true]) {
  const saved = new Map<string, unknown[]>();
  for (const row of rows) {
    const pattern = /(?<left>a)|(?<right>b)/, found = pattern.exec(row.text), log: unknown[] = [];
    if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
    const groups = found.groups; if (groups === undefined) throw new Test262Error("missing groups"); assert.compareArray(Object.keys(groups), ["left", "right"]);
    for (const name of ["left", "right"]) log.push(name, groups[name], typeof groups[name]);
  }
    log.push("last", pattern.lastIndex); saved.set(row.text, log);
  }
  for (let i = rows.length - 1; i >= 0; i--) { const row = rows[i], log = saved.get(row.text); if (log === undefined) throw new Test262Error("missing observations"); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); } }
}
