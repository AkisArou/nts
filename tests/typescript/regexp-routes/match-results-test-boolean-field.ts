/*---
description: "A test boolean survives field storage while a subsequent exec exposes its matching captures."
features: [ts-regexp-routes, ts-regexp-route-match-results, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-narrowing]
---*/
// /(a)(b)?/ test passes through a function and boolean field; node keeps it consistent with the later exec captures and leaves non-global state unchanged.
type ResultRow = { text: string; expected: unknown[] };
const rows: ResultRow[] = [
  { text: "", expected: ["test", false, "last", 0, "null", "last", 0, "retained", false] },
  { text: "ab", expected: ["test", true, "last", 0, "match", 0, "ab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0, "retained", true] },
  { text: "za", expected: ["test", true, "last", 0, "match", 1, "za", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0, "retained", true] },
  { text: "😀ab", expected: ["test", true, "last", 0, "match", 2, "😀ab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0, "retained", true] },
  { text: "á", expected: ["test", true, "last", 0, "match", 0, "á", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0, "retained", true] },
  { text: "\na", expected: ["test", true, "last", 0, "match", 1, "\na", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0, "retained", true] },
  { text: "\r\nab", expected: ["test", true, "last", 0, "match", 2, "\r\nab", 3, true, "ab", "string", "a", "string", "b", "string", "last", 0, "retained", true] },
  { text: "\u2028a", expected: ["test", true, "last", 0, "match", 1, "\u2028a", 3, true, "a", "string", "a", "string", undefined, "undefined", "last", 0, "retained", true] },
  { text: "zzz", expected: ["test", false, "last", 0, "null", "last", 0, "retained", false] }
];
interface TestBox { pattern: RegExp; accepted: boolean }
function accept(pattern: RegExp, text: string): boolean { return pattern.test(text); }
for (const row of rows) for (const built of [false, true]) {
  const literal = /(a)(b)?/, box: TestBox = { pattern: built ? new RegExp(literal.source, literal.flags) : literal, accepted: false };
  box.accepted = accept(box.pattern, row.text); const log: unknown[] = ["test", box.accepted, "last", box.pattern.lastIndex], found = box.pattern.exec(row.text);
  if (found === null) log.push("null");
  else {
    log.push("match", found.index, found.input, found.length, found.groups === undefined);
    for (let c = 0; c < found.length; c++) log.push(found[c], typeof found[c]);
  }
  log.push("last", box.pattern.lastIndex, "retained", box.accepted); assert.compareArray(log, row.expected); for (let i = 0; i < log.length; i++) { assert.sameValue(Object.is(log[i], row.expected[i]), true); assert.sameValue(typeof log[i], typeof row.expected[i]); }
}
