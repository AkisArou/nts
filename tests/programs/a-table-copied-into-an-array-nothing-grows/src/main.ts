// The copies of a-table-copied-into-an-array (`nts_map_keys_into`,
// `nts_map_values_into`) in a program where no array can grow. A backend that
// holds such an array bare -- the JVM's `double[]`, `boolean[]`, reference
// arrays and `NtsValue[]` -- fills that rather than a growable wrapper, which
// is all that program, whose arrays grow, can reach. Holes and a re-add in each.

class Point {
  constructor(public x: number) {}
}

export function numbers(n: number): number {
  const m = new Map<number, number>();
  for (let i = 1; i <= 4; i++) m.set(i * n, i * 10);
  m.delete(2 * n);
  m.delete(1 * n);
  m.set(1 * n, 5);
  const keys = Array.from(m.keys());
  const values = [...m.values()];
  let total = 0;
  for (let i = 0; i < keys.length; i++) total = total * 31 + keys[i] * 7 + values[i];
  return total + keys.length * 1000;
}

export function flags(n: number): number {
  const m = new Map<string, boolean>();
  m.set("a" + n, n > 0);
  m.set("b", true);
  m.set("cc", false);
  m.delete("b");
  const values = [...m.values()];
  const names = Array.from(m.keys());
  return (values[0] ? 1 : 0) + (values[1] ? 2 : 0) + names.length * 10 + names[1].length * 100;
}

export function members(n: number): number {
  const a = new Point(n);
  const b = new Point(n + 1);
  const s = new Set<Point>([a, b]);
  s.delete(a);
  s.add(a);
  const copy = [...s];
  return (copy[0] === b ? 1 : 0) + (copy[1] === a ? 10 : 0) + copy.length * 100 + copy[1].x;
}

export function unknowns(n: number): string {
  const s = new Set<unknown>([n, "x", true, null]);
  s.delete("x");
  const copy = Array.from(s);
  let text = "";
  for (let i = 0; i < copy.length; i++) text += String(copy[i]) + ";";
  return text + copy.length;
}
