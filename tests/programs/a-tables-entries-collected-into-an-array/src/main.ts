// A table's entries collected into an array: `Array.from(map)`, `[...map]`,
// either over `entries()`, a Set's `entries()` (`[v, v]`), an array's
// `entries()` (`[i, x]`) and the rest element `[...pairs] = map`. Each live
// entry becomes a fresh pair, in entry order -- a re-added key at the end,
// holes at both ends skipped. A pair of unlike things is a tuple object and a
// pair of like things is a two-slot array, so both are here. `byHand` builds
// the same pairs with `for...of`, the loop each form stands for, and every
// answer must equal it.

class Point {
  constructor(public x: number) {}
}

function scores(n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i <= 5; i++) m.set("k" + i, i * n);
  m.delete("k1"); // a hole at the front
  m.delete("k5"); // and at the back
  m.delete("k3"); // and between
  m.set("k2", 21 + n); // replaced in place
  m.set("k1", 11 + n); // re-added: at the end now
  return m;
}

function show(pairs: [string, number][]): string {
  return pairs.map((pair) => pair[0] + "=" + pair[1]).join(",");
}

/** A Map of unlike keys and values, four ways: each pair a tuple object. */
export function unlike(n: number): string {
  const m = scores(n);
  return [
    show(Array.from(m)),
    show(Array.from(m.entries())),
    show([...m]),
    show([...m.entries()]),
  ].join("|");
}

/** A Map of like keys and values: each pair a two-slot array. */
export function like(n: number): string {
  const m = new Map<string, string>([["a", "x" + n], ["b", "y"], ["c", "z"]]);
  m.delete("b");
  const pairs = [...m];
  const again = Array.from(m.entries());
  return pairs.map((p) => p[0] + p[1]).join(",") + "|" + again.length + again[1][1];
}

/** The pairs are fresh: writing one changes neither the table nor the others. */
export function fresh(n: number): string {
  const m = scores(n);
  const pairs = [...m];
  pairs[0][1] = -1;
  const again = [...m];
  return show(pairs) + "|" + show(again) + "|" + m.get(pairs[0][0]);
}

/** Sorted by value, then read: the refused program the Chromium lane wrote. */
export function largest(n: number): string {
  const totals = new Map<string, number>([["rent", 900], ["food", 300 + n], ["fun", n * 7]]);
  const entries = [...totals.entries()];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  return top === undefined ? "" : top[0] + ":" + top[1];
}

/** A literal pair beside walked ones: one array, one representation. */
export function mixed(n: number): string {
  const m = scores(n);
  const pairs: [string, number][] = [["first", 0], ...m, ["last", n]];
  const like = new Map<string, string>([["a", "x"]]);
  const strings = [["s", "t" + n], ...like.entries()];
  return show(pairs) + "|" + strings.map((p) => p[0] + p[1]).join(",");
}

/** A Set's entries are each member twice. */
export function setEntries(n: number): string {
  const s = new Set<number>([n, n + 1, n + 2]);
  s.delete(n + 1);
  s.add(n + 1);
  return [...s.entries()].map((p) => p[0] + "/" + p[1]).join(",") + "|" +
    Array.from(s.entries()).length;
}

/** An array's entries are each position and element. */
export function arrayEntries(n: number): string {
  const xs = ["a", "b", "c" + n];
  const ys = [n, n * 2];
  return [...xs.entries()].map((p) => p[0] + p[1]).join(",") + "|" +
    Array.from(ys.entries()).map((p) => p[0] * 100 + p[1]).join(",");
}

/** Object values, held by the pairs and the table both: each pair a tuple
 * object of a number and a reference, so the reference is retained. */
export function objects(n: number): number {
  const m = new Map<number, Point>();
  for (let i = 0; i < 4; i++) m.set(i, new Point(i * n));
  m.delete(1);
  const pairs = Array.from(m);
  const spread = [...m.entries()];
  m.clear();
  let total = 0;
  for (const pair of pairs) total += pair[0] * 100 + pair[1].x;
  for (let i = 0; i < spread.length; i++) total += spread[i][1].x;
  return total + pairs.length * 1000;
}

/** The rest element over a Map is the same collection. */
export function rest(n: number): string {
  const m = scores(n);
  const [...pairs] = m;
  return show(pairs);
}

/** An empty table makes an empty array, each way. */
export function empty(n: number): number {
  const m = new Map<string, number>();
  m.set("gone", n);
  m.delete("gone");
  const s = new Set<number>();
  return [...m].length + Array.from(m.entries()).length + [...s.entries()].length + 7;
}

/** The control: the same pairs built by the loop each form stands for. */
export function byHand(n: number): string {
  const m = scores(n);
  const pairs: [string, number][] = [];
  for (const [key, value] of m.entries()) pairs.push([key, value]);
  return [show(pairs), show(pairs), show(pairs), show(pairs)].join("|");
}
