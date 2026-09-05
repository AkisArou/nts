// A symbol as a *value*, which is a different feature from a symbol as a
// member name.
//
// `examples/symbol-keys` is the other one: there, `[kRefed]` is resolved to a
// field name at compile time and the symbol never exists at run time at all.
// Here it does, and its whole representation is an interned cell whose
// **address is its identity**. Everything below follows from that and from
// nothing else — no description is compared anywhere.

export function freshSymbolsDiffer(n: number): number {
  // Annotated `symbol` rather than left to infer. A `const` bound to `Symbol()`
  // infers `unique symbol`, and TypeScript then refuses to compare two of them
  // as having no overlap -- which is the checker being right about types and
  // wrong about what this case is for.
  const a: symbol = Symbol("tag");
  const b: symbol = Symbol("tag");
  // Same description, different identities. A representation that interned by
  // description — or that compared descriptions — answers 1 here.
  return a === b ? 1 : n;
}

export function aSymbolIsItself(n: number): number {
  const a = Symbol("tag");
  const alias = a;
  return a === alias ? n : 0;
}

export function typeofASymbol(n: number): number {
  const a = Symbol("t");
  // `typeof` is a tag read, and the tag must fall outside the object range or
  // this answers "object".
  return typeof a === "symbol" ? n : 0;
}

export function aSymbolIsNotAnObjectOrAString(n: number): number {
  const a = Symbol("t");
  const kind = typeof a;
  return kind === "object" || kind === "string" || kind === "function" ? 0 : n;
}

// Two symbols with one description are two map keys. This is the case that
// separates identity-by-address from identity-by-description, and it is the
// shape `EventEmitter._events` needs.
export function twoSymbolsAreTwoKeys(n: number): number {
  const a = Symbol("k");
  const b = Symbol("k");
  const m = new Map<symbol, number>();
  m.set(a, n);
  m.set(b, n + 1);
  return m.size * 1000 + (m.get(a) ?? 0) * 10 + (m.get(b) ?? 0);
}

// A `string | symbol` key: the union that 318 refusal sites in `runtime/node`
// were waiting on, because `EventEmitter._events` is keyed by one.
export function aMixedKeyMap(n: number): number {
  const s = Symbol("mixed");
  const m = new Map<string | symbol, number>();
  m.set(s, n);
  m.set("mixed", n + 1);
  // A symbol and a string spelled alike are two keys, and neither finds the
  // other's value.
  return m.size * 1000 + (m.get(s) ?? 0) * 10 + (m.get("mixed") ?? 0);
}

export function aMissingSymbolKey(n: number): number {
  const present = Symbol("p");
  const absent = Symbol("p");
  const m = new Map<symbol, number>();
  m.set(present, n);
  return m.has(absent) ? 0 : n;
}

// A symbol held in a field of an object, which is what `_events` is.
class Holder {
  key: symbol;
  constructor(key: symbol) {
    this.key = key;
  }
  same(other: symbol): boolean {
    return this.key === other;
  }
}

export function aSymbolInAField(n: number): number {
  const k = Symbol("field");
  const h = new Holder(k);
  return h.same(k) && !h.same(Symbol("field")) ? n : 0;
}

// A symbol with no description at all, which is a different value from one
// described as the empty string.
export function anUndescribedSymbol(n: number): number {
  const bare: symbol = Symbol();
  const empty: symbol = Symbol("");
  return bare === empty ? 0 : n;
}

// `Symbol.for` is the *registry*: one symbol per key for the life of the
// runtime, which is the whole difference between it and `Symbol()`. The
// registry holding a strong reference is the specification's rule rather than
// a leak — a registered symbol is reachable forever by definition.
export function registeredSymbolsAreShared(n: number): number {
  const a: symbol = Symbol.for("shared");
  const b: symbol = Symbol.for("shared");
  const elsewhere: symbol = Symbol.for("other");
  const unregistered: symbol = Symbol("shared");
  return (a === b ? n : 0) + (a === elsewhere ? 100 : 0) + (a === unregistered ? 200 : 0);
}

export function theKeyASymbolWasRegisteredUnder(n: number): number {
  const a: symbol = Symbol.for("named");
  const loose: symbol = Symbol("named");
  const found = Symbol.keyFor(a);
  const missing = Symbol.keyFor(loose);
  return (found === "named" ? n : 0) + (missing === undefined ? 1 : 0);
}

// A registered symbol as a map key, which is what a well-known symbol is: the
// same identity reached from two places.
export function aRegisteredSymbolAsAKey(n: number): number {
  const m = new Map<symbol, number>();
  m.set(Symbol.for("k"), n);
  return m.get(Symbol.for("k")) ?? 0;
}
