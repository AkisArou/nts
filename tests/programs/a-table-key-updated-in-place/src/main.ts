// A table key read and then written: `counts[w] = (counts[w] || 0) + 1` and
// `m.set(k, (m.get(k) ?? 0) + 1)`. On C and LLVM the two share one lookup
// (`hir::entries`): an entry naming the slot and the table's generation, which
// the write checks before trusting it. Each function here is a shape that
// pairs, with what the entry must still get right -- a miss that inserts, an
// insert that grows the table, a `-0` key stored as `+0`, one read feeding a
// write on either arm -- or a shape that must not pair, whose answer is the
// plain calls'.

const vocabulary: string[] = [];
for (let i = 0; i < 48; i++) {
  vocabulary.push("w" + i);
}

// Pairs: a record, every first read a miss, inserts growing the table.
export function recordCounts(seed: number): number {
  const counts: Record<string, number> = {};
  const s = (seed | 0) & 255;
  for (let i = 0; i < 300 + s; i++) {
    const w = vocabulary[(i * 7 + s) % 48];
    counts[w] = (counts[w] || 0) + 1;
  }
  let total = 0;
  for (const w of vocabulary) {
    total = (total * 31 + (counts[w] ?? 0)) | 0;
  }
  return total;
}

// Pairs: a Map, through `??`.
export function mapCounts(seed: number): number {
  const counts = new Map<string, number>();
  const s = (seed | 0) & 255;
  for (let i = 0; i < 200 + s; i++) {
    const w = vocabulary[(i * 5 + s) % 48];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let total = counts.size;
  counts.forEach((n, w) => {
    total = (total * 17 + n + w.length) | 0;
  });
  return total;
}

// Pairs, and the key is stored as written by `set`: `-0` becomes `+0`.
export function negativeZeroKey(seed: number): string {
  const m = new Map<number, number>();
  const k = (seed & 1) === 0 ? -0 : 0;
  m.set(k, (m.get(k) ?? 0) + 1);
  m.set(k, (m.get(k) ?? 0) + 1);
  let first = 1;
  m.forEach((_, key) => {
    first = key;
  });
  return `${m.size}:${m.get(0)}:${Object.is(first, -0)}`;
}

// Pairs on either arm: one read, a write in each.
export function eitherArm(seed: number): number {
  const s = (seed | 0) & 255;
  const m = new Map<string, number>();
  for (let i = 0; i < 64; i++) {
    const w = vocabulary[(i + s) % 12];
    const n = m.get(w) ?? 0;
    if ((i & 1) === 0) {
      m.set(w, n + 1);
    } else {
      m.set(w, n + 100);
    }
  }
  let total = 0;
  m.forEach((n) => {
    total = (total * 7 + n) | 0;
  });
  return total;
}

function touch(m: Map<string, number>, i: number): void {
  if ((i & 3) === 0) m.delete("w0");
  else m.set("w" + (i % 9), i);
}

// Must not pair: a call between may change the table.
export function callBetween(seed: number): number {
  const s = (seed | 0) & 255;
  const m = new Map<string, number>();
  for (let i = 0; i < 80; i++) {
    const w = vocabulary[(i * 3 + s) % 9];
    const n = m.get(w) ?? 0;
    touch(m, i);
    m.set(w, n + 1);
  }
  let total = m.size;
  m.forEach((n, w) => {
    total = (total * 13 + n + w.length) | 0;
  });
  return total;
}

// Must not pair: the write is another key.
export function anotherKey(seed: number): number {
  const s = (seed | 0) & 255;
  const m = new Map<string, number>();
  for (let i = 0; i < 60; i++) {
    const w = vocabulary[(i + s) % 10];
    const v = vocabulary[(i * 7 + s) % 10];
    m.set(v, (m.get(w) ?? 0) + 1);
  }
  let total = 0;
  m.forEach((n) => {
    total = (total * 11 + n) | 0;
  });
  return total;
}

// Must not pair: the write is another table.
export function anotherTable(seed: number): number {
  const s = (seed | 0) & 255;
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (let i = 0; i < 60; i++) {
    const w = vocabulary[(i + s) % 10];
    b.set(w, (a.get(w) ?? 0) + i);
    a.set(w, (b.get(w) ?? 0) + 1);
  }
  return a.size * 1000 + (a.get("w3") ?? -1) + (b.get("w4") ?? -1);
}

// Pairs inside the loop, each time through: a delete between iterations
// moves the generation, and the next read takes a fresh entry.
export function deleteBetweenUpdates(seed: number): number {
  const s = (seed | 0) & 255;
  const m = new Map<string, number>();
  for (let i = 0; i < 90; i++) {
    const w = vocabulary[(i * 11 + s) % 15];
    m.set(w, (m.get(w) ?? 0) + 1);
    if (i % 7 === 0) m.delete(vocabulary[i % 15]);
  }
  let total = m.size;
  m.forEach((n, w) => {
    total = (total * 19 + n + w.length) | 0;
  });
  return total;
}
