// run: check
//
// A table built for one sort of key, reached through a view whose key type is
// wider. Method parameters are bivariant, so a `Map<string, number>` is a
// `Map<unknown, unknown>`, and through that view any key may arrive. C and
// LLVM build the table to hash and compare strings (`key_kind_of`, chosen at
// the constructor) and trust that choice in every call: strings() dies with
// SIGSEGV in `nts_hash_string`, hashing the number 1 as a string's pointer;
// numbers() and symbols() the same way, by their own hash.
//
// The control, createdWide(), differs in one thing: the table is created
// wide, so it hashes every key by its tag from the start, and agrees.
//
// The fix is the table's guard (table v2, S2): each call names the key kind
// it was written for, and a table that was built for another notices -- a key
// that does not fit answers "absent" to a read and widens the table on a
// write, as the JVM's `NtsTable.eraseKeys` does. Wasm declines the conversion
// by name ("no Wasm cast relates their storage"), which is why this is an
// outcome and not a program.

function readsWide(m: Map<unknown, unknown>): string {
  return `${m.get(1)} ${m.has(1)} ${m.has(true)} ${m.get(null)}`;
}

function writesWide(m: Map<unknown, unknown>): void {
  m.set(1, "one");
  m.set("k", 2);
  m.set(-0, "zero");
}

function deletesWide(m: Map<unknown, unknown>): string {
  return `${m.delete(2)} ${m.delete("missing")} ${m.delete(1)}`;
}

function show(m: Map<unknown, unknown>): string {
  const parts: string[] = [`${m.size}`];
  for (const [k, v] of m) {
    parts.push(`${typeof k}:${String(k)}=${String(v)}`);
  }
  return parts.join(" ");
}

export function strings(): string {
  const out: string[] = [];
  const typed = new Map<string, number>();
  typed.set("a", 1);
  out.push(`strings read ${readsWide(typed)}`);
  writesWide(typed);
  out.push(`strings written ${show(typed)}`);
  out.push(`strings typed ${typed.get("a")} ${typed.get("k")} ${typed.has("b")}`);
  out.push(`strings delete ${deletesWide(typed)}`);
  out.push(`strings after ${show(typed)}`);
  return out.join("\n");
}

export function numbers(): string {
  const out: string[] = [];
  const typed = new Map<number, string>();
  typed.set(1, "first");
  typed.set(2.5, "half");
  out.push(`numbers read ${readsWide(typed)}`);
  writesWide(typed);
  out.push(`numbers written ${show(typed)}`);
  out.push(`numbers typed ${typed.get(0)} ${typed.get(1)} ${typed.get(2.5)}`);
  out.push(`numbers delete ${deletesWide(typed)}`);
  out.push(`numbers after ${show(typed)}`);
  return out.join("\n");
}

export function symbols(): string {
  const out: string[] = [];
  const s = Symbol("s");
  const typed = new Map<symbol, number>();
  typed.set(s, 7);
  out.push(`symbols read ${readsWide(typed)}`);
  writesWide(typed);
  out.push(`symbols written ${show(typed)}`);
  out.push(`symbols typed ${typed.get(s)} ${typed.has(Symbol("s"))}`);
  out.push(`symbols delete ${deletesWide(typed)}`);
  out.push(`symbols after ${show(typed)}`);
  return out.join("\n");
}

function addsWide(s: Set<unknown>): string {
  s.add("two");
  s.add(3);
  return `${s.has("two")} ${s.has(2)} ${s.has(3)}`;
}

// Read through the wide view: a typed read of "two" from a `Set<number>`
// is TypeScript's own unsoundness, which no table can answer with a number.
function valuesWide(s: Set<unknown>): string {
  const parts: string[] = [];
  for (const value of s) {
    parts.push(String(value));
  }
  return parts.join(",");
}

export function sets(): string {
  const out: string[] = [];
  const typed = new Set<number>([1, 2]);
  out.push(`set ${addsWide(typed)} ${typed.has(1)} ${typed.size}`);
  out.push(`set values ${valuesWide(typed)}`);
  return out.join("\n");
}

export function createdWide(): string {
  const out: string[] = [];
  const wide = new Map<unknown, unknown>();
  wide.set("a", 1);
  out.push(`control read ${readsWide(wide)}`);
  writesWide(wide);
  out.push(`control written ${show(wide)}`);
  out.push(`control delete ${deletesWide(wide)}`);
  out.push(`control after ${show(wide)}`);
  const set = new Set<unknown>([1, 2]);
  out.push(`control set ${addsWide(set)} ${set.size}`);
  return out.join("\n");
}
