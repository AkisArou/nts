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
