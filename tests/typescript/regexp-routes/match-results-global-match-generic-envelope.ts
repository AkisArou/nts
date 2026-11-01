/*---
description: "A generic MatchArray envelope retains global full-match shape without fabricated capture metadata."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-generics, ts-narrowing]
---*/
// Global match results cross a generic envelope; node keeps full matches only and leaves index, input and named-group metadata absent.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["null", "last", 0] },
  { text: "ab a", expected: ["match", undefined, undefined, 2, true, "ab", "string", "a", "string", "last", 0] },
  { text: "za", expected: ["match", undefined, undefined, 1, true, "a", "string", "last", 0] },
  { text: "😀ab a", expected: ["match", undefined, undefined, 2, true, "ab", "string", "a", "string", "last", 0] },
  { text: "áa", expected: ["match", undefined, undefined, 2, true, "a", "string", "a", "string", "last", 0] },
  { text: "\na", expected: ["match", undefined, undefined, 1, true, "a", "string", "last", 0] },
  { text: "\r\nab", expected: ["match", undefined, undefined, 1, true, "ab", "string", "last", 0] },
  { text: "\u2028a", expected: ["match", undefined, undefined, 1, true, "a", "string", "last", 0] },
  { text: "zzz", expected: ["null", "last", 0] }
];
function envelope<T>(value: T): { value: T } { return { value }; }
for (const row of rows) for (const built of [false, true]) {
  const literal = /a(b)?/g, pattern: RegExp = built ? new RegExp(literal.source, literal.flags) : literal;
  const packet = envelope<RegExpMatchArray | null>(row.text.match(pattern)), found = packet.value, log: unknown[] = [];
  if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
  }
  if (found !== null) for (const key of ["index", "input", "groups"]) assert.sameValue(Object.hasOwn(found, key), false);
  log.push("last", pattern.lastIndex); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
