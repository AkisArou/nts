// `[...totals.entries()]` -- a Map's entries as an array, to sort them. Found
// by the Chromium lane writing an expense tracker against lib.dom
// (2026-10-14): totals per category, sorted by amount. Refused until
// 2026-10-21, when a collected entry became a pair built where it is stored
// (tests/programs/a-tables-entries-collected-into-an-array has every form);
// kept as the program that found it.
//
// Control, one difference -- the loop the spread stands for:
//
//     export function largest(): string {
//       const totals = new Map<string, number>([["rent", 900], ["food", 300]]);
//       const entries: [string, number][] = [];
//       for (const [name, sum] of totals.entries()) entries.push([name, sum]);
//       entries.sort((a, b) => b[1] - a[1]);
//       const top = entries[0];
//       return top === undefined ? "" : top[0];
//     }

export function largest(): string {
  const totals = new Map<string, number>([["rent", 900], ["food", 300]]);
  const entries = [...totals.entries()];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  return top === undefined ? "" : top[0];
}
