/*---
description: "Direct literal control: Exec arrays retain every earlier result through later matches, misses and reverse readback."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-narrowing, ts-spread]
---*/
// /a(b)?/g results are read immediately from fresh literals, with only scalar observations retained in reverse order; node retains each separate capture snapshot.
type ResultRow = { text: string; starts: number[]; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", starts: [0, 0, 0], expected: ["call", 0, "null", "last", 0, "call", 1, "null", "last", 0, "call", 2, "null", "last", 0, "read", 2, "null", "read", 1, "null", "read", 0, "null"] },
  { text: "ab a", starts: [0, 2, 4], expected: ["call", 0, "match", 0, "ab a", 2, true, "ab", "string", "b", "string", "last", 2, "call", 1, "match", 3, "ab a", 2, true, "a", "string", undefined, "undefined", "last", 4, "call", 2, "null", "last", 0, "read", 2, "null", "read", 1, "match", 3, "ab a", 2, true, "a", "string", undefined, "undefined", "read", 0, "match", 0, "ab a", 2, true, "ab", "string", "b", "string"] },
  { text: "za", starts: [0, 2, 0], expected: ["call", 0, "match", 1, "za", 2, true, "a", "string", undefined, "undefined", "last", 2, "call", 1, "null", "last", 0, "call", 2, "match", 1, "za", 2, true, "a", "string", undefined, "undefined", "last", 2, "read", 2, "match", 1, "za", 2, true, "a", "string", undefined, "undefined", "read", 1, "null", "read", 0, "match", 1, "za", 2, true, "a", "string", undefined, "undefined"] },
  { text: "😀ab a", starts: [0, 4, 6], expected: ["call", 0, "match", 2, "😀ab a", 2, true, "ab", "string", "b", "string", "last", 4, "call", 1, "match", 5, "😀ab a", 2, true, "a", "string", undefined, "undefined", "last", 6, "call", 2, "null", "last", 0, "read", 2, "null", "read", 1, "match", 5, "😀ab a", 2, true, "a", "string", undefined, "undefined", "read", 0, "match", 2, "😀ab a", 2, true, "ab", "string", "b", "string"] },
  { text: "áa", starts: [0, 1, 3], expected: ["call", 0, "match", 0, "áa", 2, true, "a", "string", undefined, "undefined", "last", 1, "call", 1, "match", 2, "áa", 2, true, "a", "string", undefined, "undefined", "last", 3, "call", 2, "null", "last", 0, "read", 2, "null", "read", 1, "match", 2, "áa", 2, true, "a", "string", undefined, "undefined", "read", 0, "match", 0, "áa", 2, true, "a", "string", undefined, "undefined"] },
  { text: "\na", starts: [0, 2, 0], expected: ["call", 0, "match", 1, "\na", 2, true, "a", "string", undefined, "undefined", "last", 2, "call", 1, "null", "last", 0, "call", 2, "match", 1, "\na", 2, true, "a", "string", undefined, "undefined", "last", 2, "read", 2, "match", 1, "\na", 2, true, "a", "string", undefined, "undefined", "read", 1, "null", "read", 0, "match", 1, "\na", 2, true, "a", "string", undefined, "undefined"] },
  { text: "\r\nab", starts: [0, 4, 0], expected: ["call", 0, "match", 2, "\r\nab", 2, true, "ab", "string", "b", "string", "last", 4, "call", 1, "null", "last", 0, "call", 2, "match", 2, "\r\nab", 2, true, "ab", "string", "b", "string", "last", 4, "read", 2, "match", 2, "\r\nab", 2, true, "ab", "string", "b", "string", "read", 1, "null", "read", 0, "match", 2, "\r\nab", 2, true, "ab", "string", "b", "string"] },
  { text: "\u2028a", starts: [0, 2, 0], expected: ["call", 0, "match", 1, "\u2028a", 2, true, "a", "string", undefined, "undefined", "last", 2, "call", 1, "null", "last", 0, "call", 2, "match", 1, "\u2028a", 2, true, "a", "string", undefined, "undefined", "last", 2, "read", 2, "match", 1, "\u2028a", 2, true, "a", "string", undefined, "undefined", "read", 1, "null", "read", 0, "match", 1, "\u2028a", 2, true, "a", "string", undefined, "undefined"] },
  { text: "zzz", starts: [0, 0, 0], expected: ["call", 0, "null", "last", 0, "call", 1, "null", "last", 0, "call", 2, "null", "last", 0, "read", 2, "null", "read", 1, "null", "read", 0, "null"] }
];
for (const row of rows) for (const built of [false, true]) {
  const saved: unknown[][] = [], log: unknown[] = [];
  for (let step = 0; step < 3; step++) {
    const pattern = /a(b)?/g; pattern.lastIndex = row.starts[step]; const found = pattern.exec(row.text), values: unknown[] = [];
    if (found === null) values.push("null");
  else {
    values.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) values.push(found[c], typeof found[c]);
  }
    saved.push(values); log.push("call", step, ...values, "last", pattern.lastIndex);
  }
  for (let i = 2; i >= 0; i--) log.push("read", i, ...saved[i]);
  assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
