// expect: NTS1001 `Map#entries`, which needs the iteration protocol
//
// `[...totals.entries()]` -- a Map's entries as an array, to sort them --
// is refused, where walking the same entries compiles: `for (const [name,
// sum] of totals.entries())` (the control below) and `for ... of totals`
// (one name per entry is a blocker of its own,
// an-entries-walk-binding-one-name).
// `[...totals]`, `[...totals.keys()]` and `Array.from(totals.entries())`
// are refused too. Found by the Chromium lane writing an expense tracker
// against lib.dom (2026-10-14): totals per category, sorted by amount.
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
