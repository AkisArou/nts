// `Record<string, V>` is a table, not a struct with no fields.
//
// `SemanticSnapshot::index_signatures` had been recorded by the frontend since
// it was written and read by nothing, and its own documentation says what for:
// "a type with an index signature cannot be a flat struct with fixed field
// offsets, because its keys are not known at compile time." Until now it was
// exactly that -- an object layout with zero fields -- so `table["k"] = v`
// refused as "`k`, which `an anonymous type` does not declare".
//
// The representation is the runtime's own string-keyed map. Three spellings
// reach it, and all three are here because they resolve differently in the
// checker and only one of them was ever tested by hand.

interface Named {
  [key: string]: number;
}

export function viaInterface(n: number): number {
  const table: Named = {};
  table["x"] = n;
  return table["x"] ?? -1;
}

export function viaInline(n: number): number {
  const table: { [key: string]: number } = {};
  table["y"] = n;
  return table["y"] ?? -1;
}

export function viaRecord(n: number): number {
  const table: Record<string, number> = {};
  table["z"] = n;
  return table["z"] ?? -1;
}

// A literal with its entries written down, which is a `set` per property.
export function withEntries(n: number): number {
  const table: Record<string, number> = { alpha: n, beta: n + 1 };
  return (table["alpha"] ?? 0) + (table["beta"] ?? 0);
}

// An absent key. `undefined` is what a table answers and what a struct could
// not have said.
export function absent(n: number): number {
  const table: Record<string, number> = { alpha: n };
  return table["missing"] === undefined ? 1 : 0;
}

// A computed key, which is the whole point: a struct has no slot for it.
export function computedKey(n: number): number {
  const table: Record<string, number> = {};
  const key = n > 0 ? "positive" : "negative";
  table[key] = n;
  return table[key] ?? -1;
}

// Overwriting, so the table is not append-only.
export function overwrite(n: number): number {
  const table: Record<string, number> = {};
  table["k"] = n;
  table["k"] = n + 100;
  return table["k"] ?? -1;
}

// Many keys, past whatever linear scan the table starts with.
export function many(n: number): number {
  const table: Record<string, number> = {};
  for (let index = 0; index < 64; index++) {
    table["key" + String(index)] = index + n;
  }
  let total = 0;
  for (let index = 0; index < 64; index++) {
    total += table["key" + String(index)] ?? 0;
  }
  return total;
}

// A table of strings, so the value type is not only a number.
export function textValues(n: number): number {
  const table: Record<string, string> = {};
  table["a"] = "alpha";
  table["b"] = n > 0 ? "beta" : "gamma";
  return (table["a"] ?? "").length + (table["b"] ?? "").length;
}

// A parameter, which is the shape that reaches a table from outside.
function lookup(table: Record<string, number>, key: string): number {
  return table[key] ?? -1;
}

export function throughParameter(n: number): number {
  const table: Record<string, number> = { only: n };
  return lookup(table, "only") + lookup(table, "absent");
}

// CONTROLS FOR THE REPRESENTATION ITSELF.
//
// A `Record` and a `Map<string, V>` now share one HIR type, and they are
// different things in the language: `Object.prototype.toString` says
// "[object Object]" for one and "[object Map]" for the other, and only one of
// them has `.get`. Nothing below can tell them apart *inside* the program --
// which is the point, both are tables -- so these check the two questions the
// language does let a program ask about a plain object.
//
// The place the difference is observable is the boundary, and a table does not
// cross it yet. When it does, a `Record` has to arrive as a plain object and a
// `Map` as a `Map`, and one representation cannot answer both. That is written
// here because it is the trap this change sets for the next one.
export function tableIsAnObject(n: number): number {
  const table: Record<string, number> = { a: n };
  return typeof table === "object" ? 1 : 0;
}

export function tableIsNotAnArray(n: number): number {
  const table: Record<string, number> = { a: n };
  return Array.isArray(table) ? 1 : 0;
}

// A spread, which is where a copy of a table comes from. `querystring`'s
// `addKeyVal` is `return { ...obj, ["__proto__"]: value }` and its own comment
// records why the order matters: node appends the new key where it is
// encountered, and building the replacement with it first made
// `parse("a&__proto__")` enumerate as `__proto__, a`. A differential over four
// thousand generated queries found that; none of the module's pinned files
// covers key order.
export function spreadThenSet(n: number): number {
  const first: Record<string, number> = { a: n, b: n + 1 };
  const second: Record<string, number> = { ...first, c: n + 2 };
  return (second["a"] ?? 0) + (second["b"] ?? 0) + (second["c"] ?? 0);
}

// The copy is a copy: writing the second does not reach the first.
export function spreadIsACopy(n: number): number {
  const first: Record<string, number> = { a: n };
  const second: Record<string, number> = { ...first };
  second["a"] = n + 100;
  return (first["a"] ?? 0) * 1000 + (second["a"] ?? 0);
}

// A spread that overwrites an existing key keeps its position rather than
// appending, which is what a copy-then-set does and what node does.
export function spreadOverwrites(n: number): number {
  const first: Record<string, number> = { a: n, b: n + 1 };
  const second: Record<string, number> = { ...first, a: n + 50 };
  return (second["a"] ?? 0) * 1000 + (second["b"] ?? 0);
}

// A computed key, which a struct has no slot for.
export function computedInLiteral(n: number): number {
  const key = n > 0 ? "high" : "low";
  const table: Record<string, number> = { [key]: n };
  return table[key] ?? -1;
}

// `Object.keys` of a table walks what is in it, in insertion order.
export function keyOrder(n: number): number {
  const table: Record<string, number> = { zebra: n, alpha: n + 1, mid: n + 2 };
  const keys = Object.keys(table);
  let total = 0;
  for (let index = 0; index < keys.length; index++) {
    total = total * 31 + (keys[index] ?? "").length + index;
  }
  return total;
}

export function keysAfterSpread(n: number): number {
  const first: Record<string, number> = { a: n, bb: n };
  const second: Record<string, number> = { ...first, ccc: n };
  const keys = Object.keys(second);
  let total = 0;
  for (let index = 0; index < keys.length; index++) {
    total = total * 10 + (keys[index] ?? "").length;
  }
  return total;
}

export function keysOfEmpty(n: number): number {
  const table: Record<string, number> = {};
  return Object.keys(table).length + n * 0;
}

// A TABLE THAT IS A FIELD OF AN OBJECT LITERAL, which is the shape every case
// above is missing and the one that crashed node.
//
// `os.constants` is `{ UV_UDP_REUSEADDR: number; signals, errno, priority,
// dlopen: Record<string, number> }`, each written `{}`. An object literal's
// property value had no contextual type, so the inner `{}` fell back to *its
// own* type -- an anonymous object with no members -- and became an
// `NtsObj_Type9` stored into an `NtsMap *` field. `readConstants()` runs at
// module init, so `nts_map_set` on one segfaulted node during `require`, with
// nothing on stdout, and every `os` test failed as a crashed child.
//
// It was invisible while every such field was an object: an empty layout stored
// into a slot expecting a layout is the same pointer. A table is the first
// field type where the two differ.

interface Holder {
  count: number;
  signals: Record<string, number>;
}

export function tableInsideAnObjectLiteral(n: number): number {
  const holder: Holder = { count: n, signals: {} };
  holder.signals["x"] = n;
  return (holder.signals["x"] ?? -1) + holder.count;
}

export function tableFieldWithEntries(n: number): number {
  const holder: Holder = { count: n, signals: { a: n, b: n + 1 } };
  return (holder.signals["a"] ?? 0) + (holder.signals["b"] ?? 0);
}

// Through a function's return, which is `readConstants()`'s shape exactly.
function makeHolder(n: number): Holder {
  const holder: Holder = { count: n, signals: {} };
  const table = holder.signals;
  table["built"] = n;
  return holder;
}

export function tableFieldThroughAReturn(n: number): number {
  return makeHolder(n).signals["built"] ?? -1;
}

// Two table fields on one object, so a shared allocation would show up as one
// answering for the other.
interface Pair {
  left: Record<string, number>;
  right: Record<string, number>;
}

export function twoTableFields(n: number): number {
  const pair: Pair = { left: {}, right: {} };
  pair.left["k"] = n;
  pair.right["k"] = n + 100;
  return (pair.left["k"] ?? 0) * 1000 + (pair.right["k"] ?? 0);
}
