// A table's keys or values copied into an array in one call
// (`nts_map_keys_into`, `nts_map_values_into`): `Array.from` of a Set or of a
// Map's keys or values, and the same spread. The entries come out live and in
// entry order -- a re-added key at the end, holes at both ends skipped -- each
// as the type the table stores it as. `byHand` collects the same tables with
// `for...of`, the walk the copy replaced, and every answer must equal it.

class Point {
  constructor(public x: number) {}
}

function numbers(n: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 1; i <= 5; i++) m.set(i * n, i * 10);
  m.delete(1 * n); // a hole at the front
  m.delete(5 * n); // and at the back
  m.delete(3 * n); // and between
  m.set(2 * n, 21); // replaced in place
  m.set(1 * n, 11); // re-added: at the end now
  return m;
}

/** Keys and values of a Map with holes and a re-add. */
export function mapParts(n: number): string {
  const m = numbers(n);
  return Array.from(m.keys()).join(",") + "|" + Array.from(m.values()).join(",");
}

/** The same through spread. */
export function mapSpread(n: number): string {
  const m = numbers(n);
  return [...m.keys()].join(",") + "|" + [...m.values()].join(",");
}

/** A Set, its keys and its values: all three are its members. */
export function setForms(n: number): string {
  const s = new Set<number>([n, n + 1, n + 2, n + 3]);
  s.delete(n);
  s.delete(n + 3);
  s.add(n);
  return [
    Array.from(s).join(","),
    Array.from(s.keys()).join(","),
    Array.from(s.values()).join(","),
    [...s].join(","),
    [...s.values()].join(","),
  ].join("|");
}

/** Members of every kind, with NaN once and -0 stored as +0. */
export function mixed(n: number): string {
  const s = new Set<unknown>();
  s.add(n);
  s.add("s" + n);
  s.add(true);
  s.add(null);
  s.add(undefined);
  s.add(0 / 0);
  s.add(0 / 0);
  s.add(-0);
  s.add({ k: n });
  const copy = Array.from(s);
  let text = "";
  for (const it of copy) {
    text += (it === null ? "null" : typeof it === "object" ? "object" : typeof it + ":" + String(it)) + " ";
  }
  return text + Object.is(copy[6], -0);
}

/** Objects copied out are the objects held. */
export function objects(n: number): number {
  const a = new Point(n);
  const b = new Point(n * 2);
  const s = new Set<Point>([a, b]);
  const copy = [...s];
  return (copy[0] === a ? 1 : 0) + (copy[1] === b ? 10 : 0) + copy[0].x + copy[1].x;
}

/** String keys and boolean values. */
export function kinds(n: number): string {
  const m = new Map<string, boolean>();
  m.set("a" + n, true);
  m.set("b", false);
  m.set("c", n > 0);
  m.delete("b");
  const flags = [...m.values()];
  let text = "";
  for (const flag of flags) text += flag ? "T" : "F";
  return Array.from(m.keys()).join(",") + "|" + text + flags.length;
}

/** An empty table copies to an empty array. */
export function empty(n: number): number {
  const s = new Set<number>();
  const m = new Map<number, string>();
  return Array.from(s).length + [...m.keys()].length + [...m.values()].length + n;
}

/** The control: the same tables collected by hand, which every copy above must equal. */
export function byHand(n: number): string {
  const m = numbers(n);
  const keys: number[] = [];
  for (const k of m.keys()) keys.push(k);
  const values: number[] = [];
  for (const v of m.values()) values.push(v);
  return keys.join(",") + "|" + values.join(",");
}
