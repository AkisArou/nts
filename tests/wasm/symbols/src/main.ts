// Symbols: a cell whose identity is its address, holding its description.
// `Symbol.for` keeps a registry from key to symbol; `Symbol.keyFor` answers a
// registered symbol's key and nothing for any other.

function key(v: number): string {
  return v > 0 ? "k" + (v | 0) : "";
}

export function descriptions(v: number): string {
  const described = Symbol(key(v));
  const bare = Symbol();
  return `${described.description}|${bare.description === undefined}|${String(described)}|${bare.toString()}`;
}

export function identity(v: number): number {
  const a: symbol = Symbol(key(v));
  const b: symbol = Symbol(key(v));
  const r1: symbol = Symbol.for(key(v));
  const r2: symbol = Symbol.for(key(v));
  const other: symbol = Symbol.for(key(v) + "x");
  return (a === b ? 1 : 0) + (a === a ? 10 : 0) + (r1 === r2 ? 100 : 0) + (r1 === other ? 1000 : 0) + (r1 === a ? 10000 : 0);
}

export function keys(v: number): string {
  const registered = Symbol.for(key(v));
  const plain = Symbol(key(v));
  const found = Symbol.keyFor(registered);
  const none = Symbol.keyFor(plain);
  return `${found}|${none === undefined}`;
}

function open(value: unknown): unknown {
  return value;
}

export function erased(v: number): string {
  const value = open(v > 0 ? Symbol("s" + (v | 0)) : Symbol());
  return `${typeof value}|${String(value)}`;
}

export function mapKeys(v: number): number {
  const a: symbol = Symbol("a");
  const b: symbol = Symbol("a");
  const shared: symbol = Symbol.for("shared");
  const counts = new Map<symbol, number>();
  counts.set(a, 1);
  counts.set(b, 2);
  counts.set(Symbol.for("shared"), 3);
  counts.set(shared, (counts.get(shared) ?? 0) + (v | 0));
  return counts.size * 1000 + (counts.get(a) ?? -1) * 100 + (counts.get(b) ?? -1) * 10 + (counts.get(shared) ?? -1);
}

// Symbols as keys of a Map whose keys are open, beside strings: hashed by
// identity, so a registered symbol is found again and a fresh one is not.
export function openKeys(v: number): string {
  const table = new Map<unknown, number>();
  const key = Symbol.for(`k${(v | 0) & 3}`);
  table.set(key, 1);
  table.set(`k${(v | 0) & 3}`, 2);
  table.set(Symbol("fresh"), 3);
  return `${table.get(Symbol.for(`k${(v | 0) & 3}`))}|${table.get(`k${(v | 0) & 3}`)}|${table.get(Symbol("fresh"))}|${table.size}|${table.has(key)}`;
}
