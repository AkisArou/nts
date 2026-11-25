// A table write borrows the key it is handed (#902).
//
// `counts.set(w, (counts.get(w) ?? 0) + 1)` reads `w` out of an array, and
// the read is good for as long as nothing overwrites that array's slot. A
// write of a table stores only into the table, so the key needs no count of
// its own across it: the table takes one when the key is first inserted, and
// an update takes none. Every arm here checks that what the write may still
// free, or what may still overwrite the key's slot, keeps the count it needs.
//
// Run under `NTS_RC=1 NTS_POISON=1` as well as plainly: a borrow that outlived
// what it was read from reads poisoned memory and disagrees with node.
//
// A `Map` or `Set` subclass overriding `set` or `add` would run program code
// inside the write; it is refused today and never lowers to a table helper
// (`tests/refusals/a-table-subclass-overriding-its-write`).

const vocabulary: string[] = [];
for (let i = 0; i < 32; i++) {
  vocabulary.push("word" + i);
}

/** First insertions and updates of keys read out of a settled global array. */
export function updates(seed: number): number {
  const counts = new Map<string, number>();
  let state = 1 + ((seed | 0) & 255);
  for (let i = 0; i < 200; i++) {
    state = (state * 75 + 74) % 65537;
    const w = vocabulary[state & 31];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let total = counts.size * 1000;
  for (const [word, count] of counts) {
    total = (total + word.length * count) | 0;
  }
  return total;
}

function countAll(words: string[], rounds: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rounds; i++) {
    const w = words[(i * 7) % words.length];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

/** Keys read out of a parameter's array; the table outlives the array. */
export function fromAParameter(n: number): number {
  const words: string[] = [];
  for (let i = 0; i < 5 + ((n | 0) & 7); i++) words.push("p" + i);
  const counts = countAll(words, 40);
  words.length = 0;
  let total = 0;
  for (const [word, count] of counts) total += word.length + count * 3;
  return total;
}

// Made of four runtime strings, as each replacement is, so the objects the
// global holds stay as many whichever case replaced it last.
let unsettled: string[] = [];
for (let i = 0; i < 4; i++) {
  unsettled.push("u" + i);
}

/** Replaces the array `fromUnsettled` reads its keys from. */
export function replaceUnsettled(n: number): number {
  const next: string[] = [];
  for (let i = 0; i < 4; i++) {
    next.push("v" + ((n | 0) + i));
  }
  unsettled = next;
  return unsettled.length;
}

/**
 * Keys read out of a global array that a store may replace: the array is no
 * anchor across the write, so the key keeps a count of its own.
 */
export function fromUnsettled(n: number): number {
  const counts = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const w = unsettled[(i + (n | 0)) & 3];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let total = 0;
  for (const [word, count] of counts) total += word.length * 10 + count;
  return total;
}

/** The key's slot is overwritten between its read and the write. */
export function sourceOverwritten(n: number): number {
  const words: string[] = [];
  for (let i = 0; i < 4; i++) words.push("s" + i + "-" + (n | 0));
  const counts = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const at = i & 3;
    const w = words[at];
    words[at] = "t" + i;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let total = 0;
  for (const [word, count] of counts) total += word.length * 10 + count;
  return total;
}

class Shelf {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  relabel(to: string): void {
    this.label = to;
  }
}

/** The key's slot is overwritten by a call between its read and the write. */
export function sourceOverwrittenByACall(n: number): number {
  const shelf = new Shelf("first" + (n | 0));
  const counts = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const label = shelf.label;
    shelf.relabel("next" + i);
    counts.set(label, (counts.get(label) ?? 0) + i);
  }
  let total = 0;
  for (const [word, count] of counts) total += word.length * 10 + count;
  return total;
}

function widen(table: Map<string, unknown>, key: string): void {
  table.set(key, new Shelf(key));
}

/** The same table written through a wider alias, and keyed by `unknown`. */
export function widenedAliases(n: number): number {
  const counts = new Map<string, number>();
  const anything = new Map<unknown, number>();
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const w = vocabulary[(i * 3 + (n | 0)) & 31];
    const k: unknown = w;
    anything.set(k, (anything.get(k) ?? 0) + 1);
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (i === 4) widen(counts as unknown as Map<string, unknown>, w);
    counts.set(w, 1);
  }
  for (const [word, count] of counts) total += word.length + count;
  for (const [word, count] of anything) total += (word as string).length * count;
  return total;
}

function entriesOf(n: number): [string, number][] {
  const table = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const w = "made" + ((i * (n | 0)) & 3) + "x" + i;
    table.set(w, (table.get(w) ?? 0) + i);
  }
  const pairs = [...table.entries()];
  table.clear();
  return pairs;
}

/** A tuple's key outlives the table it was read from. */
export function aTupleOutlivesItsMap(n: number): number {
  const pairs = entriesOf(n);
  let total = 0;
  for (const [word, count] of pairs) total += word.length * 100 + count;
  return total + pairs.length;
}

class Item {
  constructor(public n: number) {}
}

class Holder {
  items: Item[] = [];
  name: string;
  constructor(name: string, n: number) {
    this.name = name;
    this.items.push(new Item(n));
  }
}

function filled(n: number): Map<string, Holder> {
  const m = new Map<string, Holder>();
  m.set("a", new Holder("held" + (n | 0), n));
  m.set("b", new Holder("other", n + 1));
  return m;
}

/** An overwrite gives up a holder whose element is still read. */
export function anOverwriteFreesTheHolder(n: number): number {
  const m = filled(n);
  const v = m.get("a")!;
  const e = v.items[0];
  m.set("a", new Holder("replacement", 7));
  return e.n + v.name.length;
}

/** A delete gives up a holder whose element is still read. */
export function aDeleteFreesTheHolder(n: number): number {
  const m = filled(n);
  const v = m.get("a")!;
  const e = v.items[0];
  m.delete("a");
  return e.n * 2 + m.size;
}

/** A clear gives up a holder whose element is still read. */
export function aClearFreesTheHolder(n: number): number {
  const m = filled(n);
  const v = m.get("b")!;
  const e = v.items[0];
  m.clear();
  return e.n * 3 + m.size;
}

/** A holder's name is the key of the write that gives the holder up. */
export function theKeyIsInTheHolderTheWriteFrees(n: number): number {
  const m = filled(n);
  const replacement = new Holder("x", 1);
  const renamed = new Holder("renamed", 2);
  const v = m.get("a")!;
  const name = v.name;
  m.set("a", replacement);
  m.set(name, renamed);
  return m.get(name)!.items[0].n + name.length;
}

/** A set holds the holder; deleting and clearing give it up. */
export function aSetGivesUpTheHolder(n: number): number {
  const s = new Set<Holder>();
  s.add(new Holder("in-set" + (n | 0), n));
  let total = 0;
  for (const h of s) {
    const e = h.items[0];
    s.delete(h);
    s.add(new Holder("again", 3));
    s.clear();
    total += e.n + h.name.length;
  }
  return total + s.size;
}
