// A `Record<string, number>` and a `Map<string, number>` hold their values as
// bare doubles on the JVM (`NtsTable`'s number value column), beside their
// boxed string keys, and `setString` takes a number value unboxed. Each export
// is one rule a box kept for free and a column has to keep on purpose: a miss
// read as `|| 0` or `?? 0` is undefined, not a stored zero; a value of -0
// keeps its sign and NaN stays NaN; a deleted key leaves a hole the walk skips
// and moves to the end when set again; a Record lists array-index keys first;
// a spread copies the column; a cleared table is refilled from the start.

const words = ["the", "a", "of", "2", "to", "10", "and", "1", "in", "is"];

export function countedWithMisses(seed: number): string {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 40 + (seed & 7); i++) {
    const w = words[(i * 7 + (seed & 15)) % words.length];
    counts[w] = (counts[w] || 0) + 1;
  }
  const missing = counts["missing"] ?? -1;
  return Object.keys(counts).join(",") + " " + counts["the"] + " " + missing;
}

export function negativeZeroAndNaNValues(seed: number): string {
  const m = new Map<string, number>();
  m.set("z", -0);
  m.set("n", NaN);
  m.set("s", seed);
  const z = m.get("z") ?? 1;
  const n = m.get("n") ?? 1;
  return Object.is(z, -0) + " " + Number.isNaN(n) + " " + (m.get("missing") ?? -1) + " " + m.get("s");
}

export function holesKeepTheOrder(seed: number): string {
  const m = new Map<string, number>();
  for (let i = 0; i < 20; i++) m.set("k" + i, i + seed);
  for (let i = 0; i < 20; i += 3) m.delete("k" + i);
  m.set("k0", 100);
  m.set("k1", 200);
  const out: string[] = [];
  for (const [k, v] of m) out.push(k + ":" + v);
  return out.join(" ");
}

export function valuesCopiedOut(seed: number): string {
  const m = new Map<string, number>();
  for (let i = 0; i < 12; i++) m.set("w" + i, i * 1.5 + seed);
  const dense = Array.from(m.values());
  m.delete("w3");
  const holed = [...m.values()];
  const record: Record<string, number> = { b: seed, a: 2, c: 3 };
  const listed = Object.keys(record).map((k) => record[k]);
  return dense.length + " " + holed.join(",") + " " + listed.join(",");
}

export function spreadThenClear(seed: number): string {
  const record: Record<string, number> = { x: 1, y: 2 };
  record["z"] = seed;
  const copy = { ...record };
  record["x"] = 10;
  const m = new Map<string, number>();
  for (let i = 0; i < 9; i++) m.set("e" + i, i);
  m.clear();
  m.set("after", seed);
  let total = 0;
  for (const v of m.values()) total += v;
  return copy["x"] + " " + copy["z"] + " " + record["x"] + " " + m.size + " " + total + " " + m.has("e0");
}
