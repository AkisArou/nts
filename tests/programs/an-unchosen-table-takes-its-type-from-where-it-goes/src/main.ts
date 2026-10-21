// `new Map()` and `new Set()` that name no type arguments. The library's
// overloads answer `Map<any, any>` (the zero-argument `new ()`) and
// `Set<any>`, which say nothing about the contents, so where the value goes
// chooses them: a return, a declaration, a field, an assignment, an argument,
// and a choice that passes one on. With no destination the table stays
// erased (`noDestination`), and a destination that chooses only the values
// is still a choice (`valuesChosen`).
//
// Before, every arm here but `noDestination` returned or stored an erased
// table where a typed one was promised: C, LLVM and the JVM agreed, and Wasm
// declined each function. The one-change control is
// tests/outcomes/a-map-with-no-type-arguments-returned-through-a-choice's.

function returned(): Map<string, number> {
  return new Map();
}

export function directReturn(seed: number): number {
  const m = returned();
  m.set("k" + (seed & 3), seed);
  m.set("k0", 1);
  return m.size * 100 + (m.get("k0") ?? -1);
}

export function declared(seed: number): number {
  const m: Map<string, number> = new Map();
  m.set("a", seed);
  m.set("a", (m.get("a") ?? 0) + 1);
  return m.size * 1000 + (m.get("a") ?? -1);
}

class Counter {
  counts: Map<string, number> = new Map();
  seen: Set<string>;
  constructor() {
    this.seen = new Set();
  }
  bump(key: string): number {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    this.seen.add(key);
    return n;
  }
}

export function field(seed: number): number {
  const c = new Counter();
  c.bump("a");
  return c.bump((seed & 1) === 0 ? "a" : "b") * 100 + c.counts.size * 10 + c.seen.size;
}

function fill(m: Map<string, number>, seed: number): number {
  m.set("x", seed);
  m.set("y", seed + 1);
  return (m.get("x") ?? 0) + (m.get("y") ?? 0) + m.size;
}

export function argument(seed: number): number {
  return fill(new Map(), seed);
}

function make(seed: number): Map<string, number> | undefined {
  return (seed & 1) === 0 ? undefined : new Map();
}

export function conditional(seed: number): number {
  const m = make(seed);
  if (m === undefined) return -1;
  m.set("a", seed);
  return m.size * 10 + (m.get("a") === seed ? 1 : 0);
}

function either(seed: number): Map<string, number> {
  return (seed & 1) === 0 ? new Map([["x", 1]]) : new Map();
}

export function choiceOfTwo(seed: number): number {
  const m = either(seed);
  m.set("y", seed);
  return m.size * 10 + (m.get("x") ?? 0);
}

export function nullish(seed: number): number {
  const prior: Map<string, number> | undefined =
    (seed & 2) === 0 ? undefined : new Map([["p", 5]]);
  const m: Map<string, number> = prior ?? new Map();
  m.set("q", seed);
  return m.size * 10 + (m.get("p") ?? 0);
}

function letters(): Set<string> {
  return new Set();
}

export function setReturned(seed: number): number {
  const s = letters();
  s.add("a");
  s.add(String(seed & 1));
  s.add("a");
  return s.size;
}

export function valuesChosen(seed: number): number {
  const m: Map<any, number> = new Map();
  m.set(seed & 1, 2);
  m.set("1", 3);
  return (m.get(1) ?? 0) + (m.get("1") ?? 0) * 10 + m.size * 100;
}

export function noDestination(seed: number): string {
  const m = new Map();
  m.set(seed & 1, "one");
  m.set("1", "text");
  m.set(1, "number");
  return String(m.size) + ":" + String(m.get(1)) + ":" + String(m.get("1"));
}
