// `Map` and `Set`: one insertion-ordered hash table, two names for it.
//
// The table stores `NtsValue`s — the same sixteen bytes an erased value
// already is — so a key and a value are erased at the call and `get` hands the
// slot back whole. That is why `get` needs no conversion on the way out: its
// type is `V | undefined`, an absent key reads as `undefined`, and those are
// the same bytes.
//
// What the key *type* buys is the probe loop. A `Map<string, V>` is built with
// the string hash and compares with the runtime's string equality; it never
// reads a tag. Only a genuinely heterogeneous key type pays for being one.
//
// Iteration is deliberately absent — `keys`, `values`, `entries`, `forEach`
// and `for...of` all need the iteration protocol, which does not exist yet and
// is refused by name rather than by silence. Everything here is reachable
// without it, which is most of what real code does with a Map: 141 of the 177
// call sites in the node profile are `get`, `set`, `has`, `delete` and `size`.

export function stringKeys(n: number): number {
  const m = new Map<string, number>();
  m.set("alpha", n);
  m.set("beta", n * 2);
  m.set("gamma", n * 3);
  return m.size * 1000 + (m.get("beta") ?? -1);
}

// Overwriting a present key replaces the value and does not add an entry.
export function overwrite(n: number): number {
  const m = new Map<string, number>();
  m.set("k", n);
  m.set("k", n + 7);
  m.set("k", n + 9);
  return m.size * 1000 + (m.get("k") ?? -1);
}

// A string key is a key by *value*: a built string finds one written as a
// literal, because the table compares text rather than addresses.
export function builtKey(n: number): number {
  const m = new Map<string, number>();
  m.set("ab", n);
  const built = "a" + "b";
  return m.get(built) ?? -1;
}

// An absent key. `get` is `undefined` and `has` is false, and they are
// different questions — a map may hold `undefined` as a value.
export function absent(n: number): number {
  const m = new Map<string, number>();
  m.set("here", n);
  const missing = m.get("nowhere") ?? -1;
  return m.has("nowhere") ? 1 : missing;
}

export function numberKeys(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 40; i++) {
    m.set(i, i * n);
  }
  return m.size * 100000 + (m.get(37) ?? -1);
}

// Deleting and reinserting. `delete` reports whether it removed something, and
// the second one has nothing to remove.
export function deleteAndReinsert(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 10; i++) {
    m.set(i, i);
  }
  const first = m.delete(3) ? 1 : 0;
  const again = m.delete(3) ? 1 : 0;
  m.set(3, n);
  return first * 10000 + again * 1000 + m.size * 10 + (m.get(3) ?? -1) / n;
}

// SameValueZero, which is what a Map compares keys with: every NaN is one key,
// and `-0` and `+0` are one key.
export function sameValueZero(n: number): number {
  const m = new Map<number, number>();
  m.set(NaN, n);
  m.set(-0, n * 2);
  const nan = m.get(NaN) ?? -1;
  const zero = m.get(0) ?? -1;
  return m.size * 100000 + nan * 100 + zero;
}

// Growth past several doublings, with every entry still findable afterwards.
export function growth(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 300; i++) {
    m.set(i, i + n);
  }
  let found = 0;
  for (let i = 0; i < 300; i++) {
    if (m.get(i) === i + n) {
      found++;
    }
  }
  return found * 1000 + m.size;
}

// Deleting most of a grown table and refilling it. The holes are compacted
// away when the table next grows, so this must not grow without bound — and
// every survivor has to still be findable across the compaction.
export function compaction(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 200; i++) {
    m.set(i, i);
  }
  for (let i = 0; i < 180; i++) {
    m.delete(i);
  }
  const after = m.size;
  for (let i = 0; i < 180; i++) {
    m.set(i, i + n);
  }
  return after * 100000 + m.size * 100 + (m.get(5) ?? -1) - n;
}

export function clearing(n: number): number {
  const m = new Map<string, number>();
  m.set("a", n);
  m.set("b", n);
  const before = m.size;
  m.clear();
  const after = m.size;
  m.set("c", n);
  return before * 100 + after * 10 + m.size;
}

// A Set: the same table with nothing stored for a value. Adding a value it
// already has changes neither the size nor the order.
export function setDedup(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 1);
  s.add(n);
  s.add(n + 2);
  s.add(n + 1);
  return s.size * 100 + (s.has(n + 2) ? 10 : 0) + (s.has(n + 99) ? 1 : 0);
}

export function setDelete(n: number): number {
  const s = new Set<string>();
  s.add("x");
  s.add("y");
  const removed = s.delete("x") ? 1 : 0;
  const again = s.delete("x") ? 1 : 0;
  return removed * 1000 + again * 100 + s.size * 10 + (s.has("y") ? 1 : 0) + n * 0;
}

// Object keys are compared by identity, which is what JavaScript does: two
// instances holding the same field are two keys.
class Node {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}

export function identityKeys(n: number): number {
  const a = new Node(n);
  const b = new Node(n);
  const m = new Map<Node, number>();
  m.set(a, 1);
  m.set(b, 2);
  const same = m.get(a) ?? -1;
  return m.size * 100 + same * 10 + (m.has(b) ? 1 : 0);
}

export function identitySet(n: number): number {
  const a = new Node(n);
  const s = new Set<Node>();
  s.add(a);
  s.add(a);
  return s.size * 10 + (s.has(a) ? 1 : 0);
}
