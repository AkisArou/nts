// Managed fields, inherited private slots and erased fields share their
// ordinary ownership rules. The runtime C suite separately observes which
// contents callback runs; this fixture checks the emitted code against node.
class Leaf {
  constructor(public value: number) {}
}

class Base {
  #held: Leaf;
  constructor(held: Leaf) { this.#held = held; }
  baseValue(): number { return this.#held.value; }
}

class Derived extends Base {
  #held: Leaf;
  payload: unknown;
  constructor(n: number) {
    const shared = new Leaf(n);
    super(shared);
    this.#held = shared;
    this.payload = (n & 3) === 0 ? shared
      : (n & 3) === 1 ? "kept"
      : (n & 3) === 2 ? BigInt(n) : n;
  }
  read(): number {
    const p = this.payload;
    const extra = typeof p === "string" ? p.length
      : typeof p === "bigint" ? Number(p)
      : typeof p === "number" ? p
      : p instanceof Leaf ? p.value : 0;
    return this.baseValue() + this.#held.value + extra;
  }
}

// The native execution test inspects this owned result's dynamic descriptor
// before releasing it, so an emitted-but-unwired callback cannot pass.
export function ownedGraph(x: number): Derived {
  return new Derived(x);
}

export function typedGraph(x: number): number {
  const n = (x & 7) + 1;
  const values: Derived[] = [];
  for (let i = 0; i < 32; i++) values.push(new Derived(n + i));
  let result = 0;
  for (const value of values) result += value.read();
  return result;
}

class Link {
  next: Link | null = null;
  erased: unknown = null;
  constructor(public value: number) {}
}

export function cycleGraph(x: number): number {
  const n = (x & 7) + 1;
  const ring: Link[] = [];
  let result = 0;
  for (let i = 0; i < 32; i++) {
    const a = new Link(n + i);
    const b = new Link(n - i);
    a.next = b;
    b.erased = a;
    ring.push(a);
  }
  for (const a of ring) {
    const b = a.next!;
    result += a.value + b.value + (b.erased instanceof Link ? 1 : 0);
  }
  return result;
}

export function deepGraph(x: number): number {
  const n = (x & 7) + 1;
  let head: Link | null = null;
  for (let i = 0; i < 129 * n; i++) {
    const node = new Link(i);
    node.next = head;
    head = node;
  }
  let result = 0;
  while (head !== null) {
    result += head.value;
    head = head.next;
  }
  return result;
}
